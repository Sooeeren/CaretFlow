//! PDF export: render an HTML file in a hidden webview, print it to PDF with the
//! platform engine (WebView2 on Windows, WebKitGTK on Linux), then post-process the
//! file with lopdf to add page numbers, header/footer text and document properties.

use lopdf::{dictionary, Dictionary, Document, Object, ObjectId, Stream, StringFormat};
use serde::Deserialize;
use std::path::{Path, PathBuf};
#[cfg(not(target_os = "android"))]
use std::sync::atomic::{AtomicU32, Ordering};
#[cfg(not(target_os = "android"))]
use std::time::Duration;
#[cfg(not(target_os = "android"))]
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PdfOptions {
    /// page size in millimetres (portrait orientation)
    pub page_width_mm: f64,
    pub page_height_mm: f64,
    pub landscape: bool,
    pub margin_mm: f64,
    /// "" (none) | "n" | "n/N" | "page n of N"
    pub page_numbers: String,
    pub header: String,
    pub footer: String,
    pub skip_first_page: bool,
    pub title: String,
    pub author: String,
    pub subject: String,
    pub keywords: String,
}

#[cfg(not(target_os = "android"))]
static COUNTER: AtomicU32 = AtomicU32::new(0);

/// Export `url` (an asset:// URL of a self-contained HTML file) to `out`.
#[cfg(not(target_os = "android"))]
pub async fn export(app: AppHandle, url: String, out: String, opts: PdfOptions) -> Result<(), String> {
    let label = format!("pdf-export-{}", COUNTER.fetch_add(1, Ordering::SeqCst));
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    let tx = std::sync::Mutex::new(Some(tx));
    let parsed = url.parse().map_err(|e| format!("bad url: {e}"))?;
    let win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .visible(false)
        .inner_size(900.0, 1200.0)
        .on_page_load(move |_w, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                if let Some(tx) = tx.lock().unwrap().take() {
                    let _ = tx.send(());
                }
            }
        })
        .build()
        .map_err(|e| e.to_string())?;

    let result = async {
        tokio::time::timeout(Duration::from_secs(30), rx)
            .await
            .map_err(|_| "timed out loading the document".to_string())?
            .map_err(|_| "document load was interrupted".to_string())?;
        // let fonts, images and layout settle
        tokio::time::sleep(Duration::from_millis(500)).await;

        let raw = tmp_path(&out);
        print_to_pdf(&win, &raw, &opts).await?;
        let r = postprocess(&raw, Path::new(&out), &opts);
        let _ = std::fs::remove_file(&raw);
        r
    }
    .await;
    let _ = win.destroy();
    result
}

/// Android: the export HTML file is printed by Android's own engine (CaretFlowPlugin.kt
/// printPdf), then gets the same page numbers, header/footer and properties as on the desktop.
#[cfg(target_os = "android")]
pub async fn export_android(html: String, out: String, opts: PdfOptions) -> Result<(), String> {
    // the WebView would print its "page not found" page instead
    if !Path::new(&html).is_file() {
        return Err(format!("the export page is missing: {html}"));
    }
    let raw = tmp_path(&out);
    let (w, h) = page_mm(&opts);
    let raw_s = raw.to_string_lossy().to_string();
    let margin = opts.margin_mm;
    // the plugin gives up on its own after a minute; this is the backstop if it never answers
    let job = tauri::async_runtime::spawn_blocking(move || crate::android::print_pdf(&html, &raw_s, w, h, margin));
    tokio::time::timeout(std::time::Duration::from_secs(90), job)
        .await
        .map_err(|_| "Android did not finish the PDF in time".to_string())?
        .map_err(|e| e.to_string())??;
    let r = postprocess(&raw, Path::new(&out), &opts);
    let _ = std::fs::remove_file(&raw);
    r
}

fn tmp_path(out: &str) -> PathBuf {
    let mut p = PathBuf::from(out).into_os_string();
    p.push(".folio-raw.pdf");
    PathBuf::from(p)
}

fn page_mm(o: &PdfOptions) -> (f64, f64) {
    if o.landscape {
        (o.page_height_mm, o.page_width_mm)
    } else {
        (o.page_width_mm, o.page_height_mm)
    }
}

// ───────────────────────────── Windows: WebView2 PrintToPdf
#[cfg(windows)]
async fn print_to_pdf(win: &tauri::WebviewWindow, path: &Path, o: &PdfOptions) -> Result<(), String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{Interface, HSTRING};

    type Tx = std::sync::Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<Result<(), String>>>>>;
    fn send(tx: &Tx, r: Result<(), String>) {
        if let Some(t) = tx.lock().unwrap().take() {
            let _ = t.send(r);
        }
    }
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let tx: Tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
    let path_s = path.to_string_lossy().to_string();
    let o = o.clone();
    win.with_webview(move |wv| {
        let tx_cb = tx.clone();
        let run = || -> Result<(), String> {
            unsafe {
                let core = wv.controller().CoreWebView2().map_err(|e| e.to_string())?;
                let core7: ICoreWebView2_7 = core.cast().map_err(|e| e.to_string())?;
                let env6: ICoreWebView2Environment6 = wv.environment().cast().map_err(|e| e.to_string())?;
                let s = env6.CreatePrintSettings().map_err(|e| e.to_string())?;
                let inch = |mm: f64| mm / 25.4;
                s.SetOrientation(if o.landscape {
                    COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE
                } else {
                    COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT
                })
                .map_err(|e| e.to_string())?;
                s.SetPageWidth(inch(o.page_width_mm)).map_err(|e| e.to_string())?;
                s.SetPageHeight(inch(o.page_height_mm)).map_err(|e| e.to_string())?;
                for f in [
                    ICoreWebView2PrintSettings::SetMarginTop,
                    ICoreWebView2PrintSettings::SetMarginBottom,
                    ICoreWebView2PrintSettings::SetMarginLeft,
                    ICoreWebView2PrintSettings::SetMarginRight,
                ] {
                    f(&s, inch(o.margin_mm)).map_err(|e| e.to_string())?;
                }
                s.SetShouldPrintBackgrounds(true).map_err(|e| e.to_string())?;
                s.SetShouldPrintHeaderAndFooter(false).map_err(|e| e.to_string())?;
                let handler = PrintToPdfCompletedHandler::create(Box::new(move |hr, ok| {
                    let r = match hr {
                        Ok(()) if ok => Ok(()),
                        Ok(()) => Err("WebView2 could not write the PDF".to_string()),
                        Err(e) => Err(e.to_string()),
                    };
                    send(&tx_cb, r);
                    Ok(())
                }));
                core7
                    .PrintToPdf(&HSTRING::from(path_s.as_str()), &s, &handler)
                    .map_err(|e| e.to_string())?;
            }
            Ok(())
        };
        if let Err(e) = run() {
            log::error(&e);
            send(&tx, Err(e));
        }
    })
    .map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(60), rx)
        .await
        .map_err(|_| "timed out printing".to_string())?
        .map_err(|_| "printing failed to start".to_string())?
}

// ───────────────────────────── Linux: WebKitGTK print operation
#[cfg(target_os = "linux")]
async fn print_to_pdf(win: &tauri::WebviewWindow, path: &Path, o: &PdfOptions) -> Result<(), String> {
    use webkit2gtk::{PrintOperation, PrintOperationExt};

    let (tx, rx) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let uri = format!("file://{}", path.to_string_lossy());
    let o = o.clone();
    win.with_webview(move |wv| {
        let op = PrintOperation::new(&wv.inner());
        let settings = gtk::PrintSettings::new();
        settings.set_printer("Print to File");
        settings.set("output-file-format", Some("pdf"));
        settings.set("output-uri", Some(&uri));
        let setup = gtk::PageSetup::new();
        let paper = gtk::PaperSize::new_custom("caretflow", "CaretFlow", o.page_width_mm, o.page_height_mm, gtk::Unit::Mm);
        setup.set_paper_size(&paper);
        setup.set_orientation(if o.landscape { gtk::PageOrientation::Landscape } else { gtk::PageOrientation::Portrait });
        for (f, m) in [
            (gtk::PageSetup::set_top_margin as fn(&gtk::PageSetup, f64, gtk::Unit), o.margin_mm),
            (gtk::PageSetup::set_bottom_margin, o.margin_mm),
            (gtk::PageSetup::set_left_margin, o.margin_mm),
            (gtk::PageSetup::set_right_margin, o.margin_mm),
        ] {
            f(&setup, m, gtk::Unit::Mm);
        }
        op.set_print_settings(&settings);
        op.set_page_setup(&setup);
        let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
        let tx2 = tx.clone();
        op.connect_finished(move |_| {
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(Ok(()));
            }
        });
        op.connect_failed(move |_, err| {
            if let Some(tx) = tx2.lock().unwrap().take() {
                let _ = tx.send(Err(err.to_string()));
            }
        });
        op.print();
    })
    .map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(60), rx)
        .await
        .map_err(|_| "timed out printing".to_string())?
        .map_err(|_| "printing failed to start".to_string())??;
    // WebKit reports "finished" when the job is handed off; wait until the file is complete
    for _ in 0..100 {
        if std::fs::metadata(path).map(|m| m.len() > 0).unwrap_or(false) && Document::load(path).is_ok() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err("the PDF file was not written".into())
}

#[cfg(not(any(windows, target_os = "linux", target_os = "android")))]
async fn print_to_pdf(_win: &tauri::WebviewWindow, _path: &Path, _o: &PdfOptions) -> Result<(), String> {
    Err("PDF export is not supported on this platform".into())
}

#[allow(dead_code)]
mod log {
    pub fn error(msg: &str) {
        eprintln!("[folio pdf] {msg}");
    }
}

// ───────────────────────────── lopdf post-processing

/// PDF text string: plain bytes for ASCII, UTF-16BE with BOM otherwise.
fn pdf_string(s: &str) -> Object {
    if s.is_ascii() {
        Object::String(s.as_bytes().to_vec(), StringFormat::Literal)
    } else {
        let mut b = vec![0xFE, 0xFF];
        for u in s.encode_utf16() {
            b.extend_from_slice(&u.to_be_bytes());
        }
        Object::String(b, StringFormat::Hexadecimal)
    }
}

/// Encode text for a WinAnsi-encoded standard font (Latin-1 covers German, French, …).
fn winansi(s: &str) -> Vec<u8> {
    s.chars()
        .map(|c| match c as u32 {
            0x20..=0x7E | 0xA0..=0xFF => c as u8,
            0x2013 => 0x96, // –
            0x2014 => 0x97, // —
            0x2018 => 0x91,
            0x2019 => 0x92,
            0x201C => 0x93,
            0x201D => 0x94,
            0x2022 => 0x95, // •
            0x20AC => 0x80, // €
            _ => b'?',
        })
        .collect()
}

/// Helvetica advance widths (AFM, 1/1000 em) for 0x20..=0x7E.
const HELV: [u16; 95] = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556,
    556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833,
    722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556,
    556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334,
    260, 334, 584,
];

fn text_width(bytes: &[u8], size: f64) -> f64 {
    bytes
        .iter()
        .map(|&b| if (0x20..=0x7E).contains(&b) { HELV[(b - 0x20) as usize] as f64 } else { 556.0 })
        .sum::<f64>()
        * size
        / 1000.0
}

fn escape_pdf(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len() + 8);
    for &b in bytes {
        if matches!(b, b'(' | b')' | b'\\') {
            out.push(b'\\');
        }
        out.push(b);
    }
    out
}

fn page_number_text(fmt: &str, n: usize, total: usize) -> String {
    match fmt {
        "n" => n.to_string(),
        "n/N" => format!("{n} / {total}"),
        "page n of N" => format!("Page {n} of {total}"),
        _ => String::new(),
    }
}

fn postprocess(raw: &Path, out: &Path, o: &PdfOptions) -> Result<(), String> {
    let mut doc = Document::load(raw).map_err(|e| format!("could not read generated PDF: {e}"))?;
    let pages: Vec<ObjectId> = doc.get_pages().values().copied().collect();
    let total = pages.len();
    let needs_marks = !o.page_numbers.is_empty() || !o.header.trim().is_empty() || !o.footer.trim().is_empty();

    if needs_marks {
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
            "Encoding" => "WinAnsiEncoding",
        });
        let (w_mm, h_mm) = page_mm(o);
        let pt = |mm: f64| mm * 72.0 / 25.4;
        let size = 9.0;
        let margin = pt(o.margin_mm.max(8.0));
        let left = margin;

        for (i, page_id) in pages.iter().enumerate() {
            let n = i + 1;
            if o.skip_first_page && n == 1 {
                continue;
            }
            // real page box (falls back to the requested size)
            let (pw, ph) = media_box(&doc, *page_id).unwrap_or((pt(w_mm), pt(h_mm)));
            let right = pw - margin;
            let header_y = ph - margin / 2.0 - size / 3.0;
            let footer_y = margin / 2.0 - size / 3.0;

            let mut ops: Vec<u8> = b"q 0.42 0.42 0.42 rg BT\n".to_vec();
            let put = |text: &str, align: &str, y: f64, ops: &mut Vec<u8>| {
                let bytes = winansi(text);
                if bytes.is_empty() {
                    return;
                }
                let w = text_width(&bytes, size);
                let x = match align {
                    "center" => (pw - w) / 2.0,
                    "right" => right - w,
                    _ => left,
                };
                ops.extend_from_slice(format!("/FolioF1 {size} Tf 1 0 0 1 {x:.2} {y:.2} Tm (").as_bytes());
                ops.extend_from_slice(&escape_pdf(&bytes));
                ops.extend_from_slice(b") Tj\n");
            };
            let num = page_number_text(&o.page_numbers, n, total);
            put(o.header.trim(), "center", header_y, &mut ops);
            if o.footer.trim().is_empty() {
                put(&num, "center", footer_y, &mut ops);
            } else {
                put(o.footer.trim(), "left", footer_y, &mut ops);
                put(&num, "right", footer_y, &mut ops);
            }
            ops.extend_from_slice(b"ET Q\n");

            add_font_resource(&mut doc, *page_id, font_id)?;
            let open = doc.add_object(Stream::new(Dictionary::new(), b"q\n".to_vec()));
            let close_and_draw = doc.add_object(Stream::new(Dictionary::new(), [b"Q\n".as_slice(), &ops].concat()));
            wrap_contents(&mut doc, *page_id, open, close_and_draw)?;
        }
    }

    // Document properties
    let mut info = Dictionary::new();
    if let Ok(Object::Reference(id)) = doc.trailer.get(b"Info") {
        if let Ok(Object::Dictionary(d)) = doc.get_object(*id) {
            info = d.clone();
        }
    }
    for (k, v) in [("Title", &o.title), ("Author", &o.author), ("Subject", &o.subject), ("Keywords", &o.keywords)] {
        if !v.trim().is_empty() {
            info.set(k, pdf_string(v.trim()));
        }
    }
    info.set("Creator", pdf_string("CaretFlow"));
    let info_id = doc.add_object(info);
    doc.trailer.set("Info", Object::Reference(info_id));
    // Make PDF viewers show the title instead of the file name
    if !o.title.trim().is_empty() {
        if let Ok(cat) = doc.catalog_mut() {
            cat.set("ViewerPreferences", dictionary! { "DisplayDocTitle" => true });
        }
    }

    doc.compress();
    doc.save(out).map_err(|e| format!("could not save PDF: {e}"))?;
    Ok(())
}

fn media_box(doc: &Document, page_id: ObjectId) -> Option<(f64, f64)> {
    let mut id = page_id;
    for _ in 0..8 {
        let dict = doc.get_object(id).ok()?.as_dict().ok()?;
        if let Ok(arr) = dict.get(b"MediaBox").and_then(|o| o.as_array()) {
            let v: Vec<f64> = arr
                .iter()
                .filter_map(|o| o.as_float().ok().map(|f| f as f64).or_else(|| o.as_i64().ok().map(|i| i as f64)))
                .collect();
            if v.len() == 4 {
                return Some((v[2] - v[0], v[3] - v[1]));
            }
        }
        id = dict.get(b"Parent").ok()?.as_reference().ok()?;
    }
    None
}

/// Ensure the page's /Resources /Font dict contains /FolioF1 (resources may be inherited or indirect).
fn add_font_resource(doc: &mut Document, page_id: ObjectId, font_id: ObjectId) -> Result<(), String> {
    // Resolve the effective resources dictionary and give this page its own copy
    let mut res = Dictionary::new();
    let mut id = page_id;
    for _ in 0..8 {
        let dict = doc.get_object(id).and_then(|o| o.as_dict()).map_err(|e| e.to_string())?;
        if let Ok(r) = dict.get(b"Resources") {
            res = match r {
                Object::Reference(rid) => doc.get_object(*rid).and_then(|o| o.as_dict()).map_err(|e| e.to_string())?.clone(),
                Object::Dictionary(d) => d.clone(),
                _ => Dictionary::new(),
            };
            break;
        }
        match dict.get(b"Parent").and_then(|p| p.as_reference()) {
            Ok(p) => id = p,
            Err(_) => break,
        }
    }
    let mut fonts = match res.get(b"Font") {
        Ok(Object::Reference(fid)) => doc.get_object(*fid).and_then(|o| o.as_dict()).map_err(|e| e.to_string())?.clone(),
        Ok(Object::Dictionary(d)) => d.clone(),
        _ => Dictionary::new(),
    };
    fonts.set("FolioF1", Object::Reference(font_id));
    res.set("Font", Object::Dictionary(fonts));
    let page = doc.get_object_mut(page_id).and_then(|o| o.as_dict_mut()).map_err(|e| e.to_string())?;
    page.set("Resources", Object::Dictionary(res));
    Ok(())
}

/// Contents := [open, ...original, close_and_draw] so our drawing starts from a clean graphics state.
fn wrap_contents(doc: &mut Document, page_id: ObjectId, open: ObjectId, close: ObjectId) -> Result<(), String> {
    let mut arr = vec![Object::Reference(open)];
    let current = doc.get_object(page_id).and_then(|o| o.as_dict()).map_err(|e| e.to_string())?.get(b"Contents").ok().cloned();
    match current {
        Some(Object::Array(a)) => arr.extend(a),
        // a reference may point at a content stream or at an (indirect) array of streams
        Some(Object::Reference(r)) => match doc.get_object(r) {
            Ok(Object::Array(a)) => arr.extend(a.iter().cloned()),
            _ => arr.push(Object::Reference(r)),
        },
        _ => {}
    }
    arr.push(Object::Reference(close));
    let page = doc.get_object_mut(page_id).and_then(|o| o.as_dict_mut()).map_err(|e| e.to_string())?;
    page.set("Contents", Object::Array(arr));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A two-page PDF like the print engines write: pages with a content stream and a font.
    fn sample(path: &Path) {
        let mut doc = Document::with_version("1.7");
        let pages_id = doc.new_object_id();
        let font = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Courier" });
        let mut kids = vec![];
        for text in ["one", "two"] {
            let content = doc.add_object(Stream::new(Dictionary::new(), format!("BT /F1 12 Tf 72 720 Td ({text}) Tj ET").into_bytes()));
            let page = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                "Contents" => content,
                "Resources" => dictionary! { "Font" => dictionary! { "F1" => font } },
            });
            kids.push(page.into());
        }
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => 2 }));
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        doc.compress();
        doc.save(path).unwrap();
    }

    #[test]
    fn stamps_page_numbers_header_and_properties() {
        let dir = std::env::temp_dir().join(format!("caretflow-pdf-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (raw, out) = (dir.join("raw.pdf"), dir.join("out.pdf"));
        sample(&raw);
        let o = PdfOptions {
            page_width_mm: 210.0,
            page_height_mm: 297.0,
            landscape: false,
            margin_mm: 18.0,
            page_numbers: "n/N".into(),
            header: "Report".into(),
            footer: String::new(),
            skip_first_page: false,
            title: "Test Title".into(),
            author: "Ada".into(),
            subject: String::new(),
            keywords: String::new(),
        };
        postprocess(&raw, &out, &o).unwrap();

        let doc = Document::load(&out).unwrap();
        let pages = doc.get_pages();
        assert_eq!(pages.len(), 2);
        for (n, id) in pages.values().enumerate() {
            // every content stream of the page, decompressed (works the same across lopdf versions)
            let text: String = doc
                .get_page_contents(*id)
                .iter()
                .map(|s| {
                    let stream = doc.get_object(*s).unwrap().as_stream().unwrap();
                    String::from_utf8_lossy(&stream.decompressed_content().unwrap_or_else(|_| stream.content.clone())).to_string()
                })
                .collect();
            assert!(text.contains(&format!("({} / 2) Tj", n + 1)), "page number on page {}: {text}", n + 1);
            assert!(text.contains("(Report) Tj"), "header on page {}", n + 1);
            assert!(text.contains(if n == 0 { "(one) Tj" } else { "(two) Tj" }), "original content kept");
        }
        let info = match doc.trailer.get(b"Info").unwrap() {
            Object::Reference(id) => doc.get_object(*id).unwrap().as_dict().unwrap().clone(),
            _ => panic!("no Info"),
        };
        assert_eq!(info.get(b"Title").unwrap().as_str().unwrap(), b"Test Title");
        std::fs::remove_dir_all(&dir).ok();
    }
}
