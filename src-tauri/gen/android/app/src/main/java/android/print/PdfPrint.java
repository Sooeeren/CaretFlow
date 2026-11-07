package android.print;

// Writes a WebView's print output straight to a PDF file, without the print dialog.
// PrintDocumentAdapter's callbacks only have package-private constructors, which is why this
// small class lives in the android.print package (a widely used approach; if a future Android
// version blocks it, CaretFlowPlugin reports the error and File → Print… still works).

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;

import java.io.File;

public class PdfPrint {
  public interface Done {
    void done(String error);
  }

  public static void print(final PrintDocumentAdapter adapter, PrintAttributes attrs, final File out, final Done cb) {
    adapter.onStart();
    adapter.onLayout(null, attrs, null, new PrintDocumentAdapter.LayoutResultCallback() {
      @Override
      public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
        final ParcelFileDescriptor fd;
        try {
          fd = ParcelFileDescriptor.open(out, ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE | ParcelFileDescriptor.MODE_READ_WRITE);
        } catch (Exception e) {
          cb.done("could not create " + out.getName() + ": " + e.getMessage());
          return;
        }
        adapter.onWrite(new PageRange[] {PageRange.ALL_PAGES}, fd, new CancellationSignal(), new PrintDocumentAdapter.WriteResultCallback() {
          @Override
          public void onWriteFinished(PageRange[] pages) {
            close(fd);
            adapter.onFinish();
            cb.done(null);
          }

          @Override
          public void onWriteFailed(CharSequence error) {
            close(fd);
            adapter.onFinish();
            cb.done("writing the PDF failed: " + error);
          }

          @Override
          public void onWriteCancelled() {
            close(fd);
            cb.done("PDF export was cancelled");
          }
        });
      }

      @Override
      public void onLayoutFailed(CharSequence error) {
        cb.done("page layout failed: " + error);
      }

      @Override
      public void onLayoutCancelled() {
        cb.done("PDF export was cancelled");
      }
    }, null);
  }

  private static void close(ParcelFileDescriptor fd) {
    try {
      fd.close();
    } catch (Exception ignored) {
    }
  }
}
