import { useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { PdfPage } from "./components/PdfPage";
import pdfjsLib from "./lib/pdfjs";

/**
 * FillForm — Slice 0: scaffold + PDF upload + page-by-page preview.
 *
 * No blank detection, no field editor, no form builder, no sharing,
 * no PDF overlay yet. Those are later slices (see BUILD_PLAN.md).
 */
function App() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // pdf.js v6 destroys a document through its loading task, not the proxy.
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setError("Please choose a PDF file.");
      return;
    }

    setLoading(true);
    setError(null);
    // Destroy the previous document so a new upload starts clean.
    await loadingTaskRef.current?.destroy();
    loadingTaskRef.current = null;
    setPdf(null);
    setPageCount(0);

    try {
      const data = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data });
      loadingTaskRef.current = loadingTask;
      const doc = await loadingTask.promise;
      setFileName(file.name);
      setPdf(doc);
      setPageCount(doc.numPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open this PDF.");
    } finally {
      setLoading(false);
    }
  }

  async function clearFile() {
    await loadingTaskRef.current?.destroy();
    loadingTaskRef.current = null;
    setPdf(null);
    setPageCount(0);
    setFileName(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-xl font-bold">FillForm</h1>
            <p className="text-sm text-gray-500">
              Upload a PDF softcopy and preview it page by page.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
            >
              {pdf ? "Upload a different PDF" : "Upload PDF"}
            </button>
            {pdf && (
              <button
                type="button"
                onClick={() => void clearFile()}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-100"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </p>
        )}

        {loading && <p className="text-sm text-gray-500">Loading PDF…</p>}

        {!pdf && !loading && (
          <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white px-6 py-16 text-center">
            <p className="text-lg font-medium">No PDF uploaded yet</p>
            <p className="mt-1 text-sm text-gray-500">
              Click “Upload PDF” above and choose a PDF file. Its pages will
              appear here, one by one.
            </p>
          </div>
        )}

        {pdf && (
          <>
            <p className="text-sm text-gray-600">
              <span className="font-medium text-gray-900">{fileName}</span>
              {" — "}
              {pageCount} {pageCount === 1 ? "page" : "pages"}
            </p>
            <div className="space-y-6">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map(
                (pageNumber) => (
                  <PdfPage
                    key={pageNumber}
                    pdf={pdf}
                    pageNumber={pageNumber}
                    pageCount={pageCount}
                  />
                ),
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default App;
