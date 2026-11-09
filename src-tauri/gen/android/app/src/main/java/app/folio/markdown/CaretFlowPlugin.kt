package app.folio.markdown

// CaretFlow's Android side, called from src-tauri/src/android.rs (the frontend never calls it
// directly). Android hands files around as content:// links, so this plugin turns them into
// paths when it can, reads and writes them when it can't, and covers what the desktop gets from
// the OS: storage permission, "Open with", sharing, printing and PDF export.

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PdfPrint
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintManager
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.provider.Settings
import android.util.Base64
import android.webkit.MimeTypeMap
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream

@TauriPlugin
class CaretFlowPlugin(private val activity: Activity) : Plugin(activity) {
  companion object {
    // set on an intent once its file went to the frontend (see remember)
    private const val HANDLED = "app.folio.markdown.handled"
  }

  private val main = Handler(Looper.getMainLooper())
  // the file another app asked us to open, until the frontend picks it up
  private var pending: JSObject? = null
  // print/PDF WebViews must stay referenced until Android is done with them
  private val printing = mutableSetOf<WebView>()

  override fun load(webView: WebView) {
    super.load(webView)
    remember(activity.intent)
  }

  override fun onNewIntent(intent: Intent) {
    remember(intent)
  }

  private fun remember(intent: Intent?) {
    if (intent == null) return
    // Reopened from the recent apps after Android ended CaretFlow, the activity gets the intent
    // that first started it again; and a recreated activity (display size changed) keeps it.
    // Both are handled already: opening the file again would replace the restored draft.
    if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
    if (intent.getBooleanExtra(HANDLED, false)) return
    val r = JSObject()
    when (intent.action) {
      Intent.ACTION_VIEW, Intent.ACTION_EDIT -> intent.data?.let { r.put("uri", it.toString()) }
      Intent.ACTION_SEND -> {
        @Suppress("DEPRECATION")
        val stream = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
        if (stream != null) r.put("uri", stream.toString())
        else intent.getStringExtra(Intent.EXTRA_TEXT)?.let { r.put("text", it) }
      }
      // several files: CaretFlow shows one document at a time, so it opens the first
      Intent.ACTION_SEND_MULTIPLE -> {
        @Suppress("DEPRECATION")
        val streams = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
        streams?.firstOrNull()?.let {
          r.put("uri", it.toString())
          r.put("more", streams.size - 1)
        }
      }
    }
    if (r.length() > 0) {
      pending = r
      intent.putExtra(HANDLED, true)
    }
  }

  /** File work off the UI thread; errors go back to the caller as the message. */
  private fun bg(invoke: Invoke, work: () -> Unit) {
    Thread {
      try {
        work()
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.toString())
      }
    }.start()
  }

  // ── storage

  private fun granted(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager()
    else ContextCompat.checkSelfPermission(activity, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

  @Command
  fun storageStatus(invoke: Invoke) {
    val r = JSObject()
    r.put("granted", granted())
    r.put("sdk", Build.VERSION.SDK_INT)
    invoke.resolve(r)
  }

  @Command
  fun requestStorage(invoke: Invoke) {
    main.post {
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
          try {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + activity.packageName)))
          } catch (e: ActivityNotFoundException) {
            activity.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
          }
        } else {
          ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE), 7301)
        }
        invoke.resolve()
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  @Command
  fun dirs(invoke: Invoke) {
    val r = JSObject()
    r.put("storage", Environment.getExternalStorageDirectory().absolutePath)
    r.put("documents", Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS).absolutePath)
    // the app's own folder on shared storage: always writable, even without "All files access"
    val lib = activity.getExternalFilesDir(null) ?: activity.filesDir
    r.put("library", lib.absolutePath)
    invoke.resolve(r)
  }

  // ── content:// links

  private fun displayName(uri: Uri): String? = try {
    activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst()) c.getString(0) else null
    }
  } catch (e: Exception) {
    null
  }

  /** A real file path for a content:// link, when Android has one and we may read it. */
  private fun pathOf(uri: Uri): String? {
    if (uri.scheme == "file") return uri.path
    var p: String? = null
    try {
      val tree = uri.pathSegments.firstOrNull() == "tree"
      val id = when {
        DocumentsContract.isDocumentUri(activity, uri) -> DocumentsContract.getDocumentId(uri)
        tree -> DocumentsContract.getTreeDocumentId(uri)
        else -> null
      }
      if (id != null) {
        when (uri.authority) {
          "com.android.externalstorage.documents" -> {
            val volume = id.substringBefore(':')
            val rel = id.substringAfter(':', "")
            val root = if (volume.equals("primary", true)) Environment.getExternalStorageDirectory().absolutePath else "/storage/$volume"
            p = if (rel.isEmpty()) root else "$root/$rel"
          }
          "com.android.providers.downloads.documents" ->
            if (id.startsWith("raw:")) p = id.removePrefix("raw:")
        }
      }
      if (p == null) {
        // media and many file managers still report the file behind the link
        activity.contentResolver.query(uri, arrayOf("_data"), null, null, null)?.use { c ->
          if (c.moveToFirst()) p = c.getString(0)
        }
      }
    } catch (e: Exception) {
      p = null
    }
    val f = p?.let { File(it) } ?: return null
    return if (f.canRead()) f.absolutePath else null
  }

  @Command
  fun resolveUri(invoke: Invoke) {
    val uri = Uri.parse(invoke.getArgs().getString("uri"))
    bg(invoke) {
      // keep access across restarts where the provider allows it (recent files). Asking for
      // read + write fails as a whole when only reading was granted, so read alone after that.
      val rw = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      for (flags in intArrayOf(rw, Intent.FLAG_GRANT_READ_URI_PERMISSION)) {
        try {
          activity.contentResolver.takePersistableUriPermission(uri, flags)
          break
        } catch (e: Exception) {
        }
      }
      val r = JSObject()
      r.put("path", pathOf(uri) ?: org.json.JSONObject.NULL)
      r.put("name", displayName(uri) ?: uri.lastPathSegment ?: "Document")
      invoke.resolve(r)
    }
  }

  @Command
  fun readUri(invoke: Invoke) {
    val uri = Uri.parse(invoke.getArgs().getString("uri"))
    bg(invoke) {
      val bytes = activity.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: throw Exception("could not open the file")
      val r = JSObject()
      r.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
      invoke.resolve(r)
    }
  }

  @Command
  fun writeUri(invoke: Invoke) {
    val args = invoke.getArgs()
    val uri = Uri.parse(args.getString("uri"))
    val bytes = Base64.decode(args.getString("data"), Base64.DEFAULT)
    bg(invoke) {
      val cr = activity.contentResolver
      // "wt" truncates. Plain "w" doesn't on some providers, which leaves the end of the old,
      // longer text in the file, so the next try is "rw" with an explicit truncate.
      val done = try {
        cr.openOutputStream(uri, "wt")?.use { it.write(bytes) } != null
      } catch (e: Exception) {
        false
      } || try {
        cr.openFileDescriptor(uri, "rw")?.use { pfd ->
          FileOutputStream(pfd.fileDescriptor).use { out ->
            out.channel.truncate(0)
            out.write(bytes)
          }
        } != null
      } catch (e: Exception) {
        false
      }
      // last resort for providers that only know "w" (they replace the file on "w")
      if (!done) (cr.openOutputStream(uri, "w") ?: throw Exception("could not write the file")).use { it.write(bytes) }
      invoke.resolve()
    }
  }

  @Command
  fun uriInfo(invoke: Invoke) {
    val uri = Uri.parse(invoke.getArgs().getString("uri"))
    bg(invoke) {
      val r = JSObject()
      var exists = false
      var mtime = 0L
      try {
        activity.contentResolver.query(uri, null, null, null, null)?.use { c ->
          if (c.moveToFirst()) {
            exists = true
            val i = c.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
            if (i >= 0 && !c.isNull(i)) mtime = c.getLong(i)
          }
        }
      } catch (e: Exception) {
      }
      r.put("exists", exists)
      r.put("mtime", mtime)
      invoke.resolve(r)
    }
  }

  @Command
  fun takeIntent(invoke: Invoke) {
    val r = pending ?: JSObject()
    pending = null
    invoke.resolve(r)
  }

  // ── other apps

  private fun contentUri(path: String): Uri =
    FileProvider.getUriForFile(activity, activity.packageName + ".fileprovider", File(path))

  private fun mimeOf(path: String): String {
    val ext = path.substringAfterLast('.', "").lowercase()
    if (ext in listOf("md", "markdown", "mdown", "mkd", "mkdn", "mdx")) return "text/markdown"
    return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "*/*"
  }

  @Command
  fun share(invoke: Invoke) {
    val args = invoke.getArgs()
    val path = args.getString("path")
    val mime = args.optString("mime").ifEmpty { mimeOf(path) }
    main.post {
      try {
        val send = Intent(Intent.ACTION_SEND).apply {
          type = mime
          putExtra(Intent.EXTRA_STREAM, contentUri(path))
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(Intent.createChooser(send, null))
        invoke.resolve()
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  @Command
  fun openPath(invoke: Invoke) {
    val path = invoke.getArgs().getString("path")
    main.post {
      try {
        val view = Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(contentUri(path), mimeOf(path))
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        activity.startActivity(view)
        invoke.resolve()
      } catch (e: ActivityNotFoundException) {
        invoke.reject("No app on this device can open " + File(path).name)
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  // ── printing and PDF

  /**
   * Load an HTML file in a WebView of its own (not on screen), then hand it to `ready`; `failed`
   * when it doesn't load within 30 seconds (the desktop export waits as long).
   */
  private fun withPage(html: String, ready: (WebView) -> Unit, failed: (String) -> Unit) {
    val wv = WebView(activity)
    printing.add(wv)
    // the export page is finished HTML: no scripts (the document's own HTML is in it)
    wv.settings.javaScriptEnabled = false
    wv.settings.allowFileAccess = true
    var done = false
    wv.webViewClient = object : WebViewClient() {
      override fun onPageFinished(view: WebView, url: String) {
        if (done) return
        done = true
        // let fonts, images and layout settle (the desktop waits the same)
        main.postDelayed({ ready(view) }, 500)
      }
    }
    main.postDelayed({
      if (!done) {
        done = true
        release(wv)
        failed("the document did not load in time")
      }
    }, 30_000)
    wv.loadUrl(Uri.fromFile(File(html)).toString())
  }

  private fun release(wv: WebView) {
    main.postDelayed({
      printing.remove(wv)
      wv.destroy()
    }, 1000)
  }

  @Command
  fun printDialog(invoke: Invoke) {
    val args = invoke.getArgs()
    val html = args.getString("html")
    val title = args.optString("title").ifEmpty { "CaretFlow" }
    main.post {
      try {
        withPage(html, { wv ->
          val pm = activity.getSystemService(Activity.PRINT_SERVICE) as PrintManager
          // the dialog draws its preview and prints from this WebView for as long as it is open:
          // it may only go once Android says the print job is finished
          pm.print(title, keepUntilFinished(wv.createPrintDocumentAdapter(title), wv), null)
          invoke.resolve()
        }, { invoke.reject(it) })
      } catch (e: Exception) {
        invoke.reject(e.message ?: e.toString())
      }
    }
  }

  /** Hands everything to `inner`, and lets the WebView go when printing is over. */
  private fun keepUntilFinished(inner: PrintDocumentAdapter, wv: WebView) = object : PrintDocumentAdapter() {
    override fun onStart() = inner.onStart()

    override fun onLayout(old: PrintAttributes?, new: PrintAttributes, cancel: CancellationSignal?, cb: LayoutResultCallback, extras: Bundle?) =
      inner.onLayout(old, new, cancel, cb, extras)

    override fun onWrite(pages: Array<out PageRange>, fd: ParcelFileDescriptor, cancel: CancellationSignal?, cb: WriteResultCallback) =
      inner.onWrite(pages, fd, cancel, cb)

    override fun onFinish() {
      inner.onFinish()
      release(wv)
    }
  }

  @Command
  fun printPdf(invoke: Invoke) {
    val args = invoke.getArgs()
    val html = args.getString("html")
    val out = File(args.getString("out"))
    val mils = { mm: Double -> (mm / 25.4 * 1000).toInt() }
    val w = mils(args.getDouble("widthMm"))
    val h = mils(args.getDouble("heightMm"))
    val m = mils(args.getDouble("marginMm"))
    val attrs = PrintAttributes.Builder()
      .setMediaSize(PrintAttributes.MediaSize("caretflow", "CaretFlow", w, h))
      .setResolution(PrintAttributes.Resolution("pdf", "pdf", 300, 300))
      .setMinMargins(PrintAttributes.Margins(m, m, m, m))
      .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
      .build()
    // answered once: by the print engine, or by the time limit if it never calls back
    var settled = false
    val finish = { err: String? ->
      if (!settled) {
        settled = true
        if (err == null) invoke.resolve() else invoke.reject(err)
      }
    }
    main.post {
      try {
        withPage(html, { wv ->
          main.postDelayed({ if (!settled) release(wv); finish("Android did not finish the PDF in time") }, 60_000)
          try {
            PdfPrint.print(wv.createPrintDocumentAdapter("CaretFlow"), attrs, out) { err ->
              main.post {
                if (!settled) release(wv)
                finish(err)
              }
            }
          } catch (e: Throwable) {
            release(wv)
            finish("Android could not print the PDF: " + (e.message ?: e.toString()))
          }
        }, { finish(it) })
      } catch (e: Exception) {
        finish(e.message ?: e.toString())
      }
    }
  }

  // ── look

  /** Android 12+: the main color Android takes from the wallpaper (Material You), as #rrggbb */
  @Command
  fun systemColor(invoke: Invoke) {
    val r = JSObject()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val c = activity.getColor(android.R.color.system_accent1_500)
      r.put("color", String.format("#%06x", c and 0xffffff))
    }
    invoke.resolve(r)
  }

  @Command
  fun barColor(invoke: Invoke) {
    val args = invoke.getArgs()
    val color = try {
      Color.parseColor(args.getString("color"))
    } catch (e: Exception) {
      Color.WHITE
    }
    val dark = args.optBoolean("dark")
    main.post {
      val win = activity.window
      win.decorView.setBackgroundColor(color)
      val c = WindowInsetsControllerCompat(win, win.decorView)
      c.isAppearanceLightStatusBars = !dark
      c.isAppearanceLightNavigationBars = !dark
      invoke.resolve()
    }
  }
}
