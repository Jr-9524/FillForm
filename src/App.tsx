import { useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { PdfPage } from "./components/PdfPage";
import pdfjsLib from "./lib/pdfjs";
import { detectFields } from "./lib/detectFields";
import { createManualField, sortAndOrderFields } from "./lib/fields";
import type { DetectedField } from "./lib/fields";

/**
 * FillForm — Slice 1: scaffold + PDF upload + preview + blank detection.
 *
 * No field editor, no form builder, no sharing, no PDF overlay yet.
 * Those are later slices (see BUILD_PLAN.md).
 */
function App() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [fields, setFields] = useState<DetectedField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // pdf.js v6 destroys a document through its loading task, not the proxy.
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  // Guards against a slow detection run overwriting a newer upload.
  const detectionRunRef = useRef(0);

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
    setFields([]);

    try {
      const data = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data });
      loadingTaskRef.current = loadingTask;
      const doc = await loadingTask.promise;
      setFileName(file.name);
      setPdf(doc);
      setPageCount(doc.numPages);

      // Slice 1: detect blanks now that the document is loaded.
      const runId = ++detectionRunRef.current;
      setDetecting(true);
      try {
        const detected = await detectFields(doc);
        if (detectionRunRef.current === runId) setFields(detected);
      } catch (detectErr) {
        if (detectionRunRef.current === runId) {
          setError(
            detectErr instanceof Error
              ? `Could not detect blanks: ${detectErr.message}`
              : "Could not detect blanks.",
          );
        }
      } finally {
        if (detectionRunRef.current === runId) setDetecting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open this PDF.");
    } finally {
      setLoading(false);
    }
  }

  async function clearFile() {
    detectionRunRef.current++;
    await loadingTaskRef.current?.destroy();
    loadingTaskRef.current = null;
    setPdf(null);
    setPageCount(0);
    setFileName(null);
    setFields([]);
    setDetecting(false);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handlePageClick(pageNumber: number, x: number, y: number) {
    const label = window.prompt("Field label:", "Field");
    if (label === null) return;
    const trimmed = label.trim() || "Field";
    setFields((prev) =>
      sortAndOrderFields([
        ...prev,
        createManualField(pageNumber, x, y, trimmed),
      ]),
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
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

      <main className="mx-auto max-w-6xl px-4 py-6">
        {error && (
          <p
            role="alert"
            className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
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
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <div className="space-y-6">
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
                      onPageClick={handlePageClick}
                    />
                  ),
                )}
              </div>
            </div>

            <aside className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:sticky lg:top-6">
              <h2 className="text-base font-semibold">Detected fields</h2>
              {detecting ? (
                <p className="mt-2 text-sm text-gray-500">Detecting blanks…</p>
              ) : fields.length > 0 ? (
                <>
                  <p className="mt-1 text-sm text-gray-600">
                    {fields.length} {fields.length === 1 ? "field" : "fields"}{" "}
                    found
                  </p>
                  <ol className="mt-3 space-y-2">
                    {fields.map((field) => (
                      <li
                        key={field.id}
                        className="rounded-md border border-gray-200 px-3 py-2"
                      >
                        <p className="text-sm font-medium">
                          {field.order}. {field.label}
                        </p>
                        <p className="text-xs text-gray-500">
                          Page {field.page}
                        </p>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="mt-2 text-sm text-gray-500">
                  No blanks found — you can add fields manually
                </p>
              )}
              <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
                Tip: click on a page to add a field at that spot.
              </p>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
