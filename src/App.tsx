import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import { PdfPage } from "./components/PdfPage";
import { FillForm } from "./components/FillForm";
import pdfjsLib from "./lib/pdfjs";
import { detectFields } from "./lib/detectFields";
import { generateFilledPdf } from "./lib/generateFilledPdf";
import {
  createManualField,
  renumberFields,
  sortAndOrderFields,
} from "./lib/fields";
import type { DetectedField, FieldType } from "./lib/fields";
import {
  FONT_FAMILIES,
  getFieldFont,
  type FontFamilyId,
} from "./lib/fonts";

type View = "setup" | "fill";

/**
 * FillForm — Slice 5: scaffold + PDF upload + preview + blank detection
 * + field editor + fill form + filled-PDF download / print (pdf-lib
 * overlay at the stored blank positions).
 *
 * No sharing yet (Slice 4, skipped for now).
 * See BUILD_PLAN.md.
 */
function App() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [fields, setFields] = useState<DetectedField[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("setup");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [missingIds, setMissingIds] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [originalBytes, setOriginalBytes] = useState<ArrayBuffer | null>(null);
  const [generating, setGenerating] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  // Setup preview shows one page at a time, so the user is never
  // looking at the whole document at once.
  const [previewPage, setPreviewPage] = useState(1);
  const [fieldsCollapsed, setFieldsCollapsed] = useState(false);
  // Add-field mode: only when this is on does clicking the page add
  // a field — plain clicks no longer pop the label prompt by accident.
  const [addMode, setAddMode] = useState(false);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);

  // Match the field panel's height to the previewed page, so the
  // list scrolls inside the panel instead of pushing the page down.
  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;
    const measure = () => setPreviewHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [previewPage, pdf]);
  const inputRef = useRef<HTMLInputElement>(null);
  // pdf.js v6 destroys a document through its loading task, not the proxy.
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  // Guards against a slow detection run overwriting a newer upload.
  const detectionRunRef = useRef(0);

  const includedFields = fields.filter((field) => field.included);

  // Slice 3: save answers in this browser, keyed by file name.
  // Detection ids are deterministic for the same PDF, so a re-upload
  // restores the same answers.
  useEffect(() => {
    if (!fileName) return;
    try {
      localStorage.setItem(
        `fillform-answers:${fileName}`,
        JSON.stringify(answers),
      );
    } catch {
      // Storage full or unavailable — answers still work in memory.
    }
  }, [answers, fileName]);

  function loadSavedAnswers(name: string) {
    try {
      const raw = localStorage.getItem(`fillform-answers:${name}`);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  }

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
    setPreviewPage(1);
    setFields([]);
    setAddMode(false);
    setView("setup");
    setAnswers(loadSavedAnswers(file.name));
    setMissingIds([]);
    setSubmitted(false);
    setSelectedFieldId(null);
    setOriginalBytes(null);

    try {
      const data = await file.arrayBuffer();
      // Keep a copy for Slice 5: pdf.js may detach the buffer it reads.
      setOriginalBytes(data.slice(0));
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

  // Re-run detection on the already-loaded PDF with the current
  // code — the fields only refresh on upload otherwise, so a pull
  // that improves detection (e.g. snapping boxes onto the drawn
  // lines) would leave stale boxes on screen until now. Manual box
  // tweaks are reset; answers for fields that are still found are
  // kept (detection ids are deterministic for the same PDF).
  async function handleRedetect() {
    if (!pdf) return;
    if (
      !window.confirm(
        "Re-detect the blanks in this PDF? Your current fields and any box adjustments will be replaced. Answers for fields that are still found are kept.",
      )
    )
      return;
    const runId = ++detectionRunRef.current;
    setDetecting(true);
    setError(null);
    try {
      const detected = await detectFields(pdf);
      if (detectionRunRef.current !== runId) return;
      setFields(detected);
      setSelectedFieldId(null);
      setPreviewPage(1);
      setMissingIds([]);
      setSubmitted(false);
      setAnswers((prev) => {
        const kept: Record<string, string> = {};
        for (const field of detected) {
          if (prev[field.id] !== undefined) kept[field.id] = prev[field.id];
        }
        return kept;
      });
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
  }

  async function clearFile() {
    detectionRunRef.current++;
    await loadingTaskRef.current?.destroy();
    loadingTaskRef.current = null;
    setPdf(null);
    setPageCount(0);
    setPreviewPage(1);
    setFileName(null);
    setFields([]);
    setAddMode(false);
    setDetecting(false);
    setError(null);
    setView("setup");
    setAnswers({});
    setMissingIds([]);
    setSubmitted(false);
    setSelectedFieldId(null);
    setOriginalBytes(null);
    setGenerating(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handlePageClick(pageNumber: number, x: number, y: number) {
    const label = window.prompt("Field label:", "Field");
    if (label === null) return;
    const trimmed = label.trim() || "Field";
    const field = createManualField(pageNumber, x, y, trimmed);
    setFields((prev) => sortAndOrderFields([...prev, field]));
    // Select the new field so it can be dragged and resized at once.
    setSelectedFieldId(field.id);
  }

  // Slice 2: field editor helpers.
  function updateField(id: string, patch: Partial<DetectedField>) {
    setFields((prev) =>
      prev.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    );
  }

  function deleteField(id: string) {
    setFields((prev) =>
      renumberFields(prev.filter((field) => field.id !== id)),
    );
  }

  function moveField(id: string, direction: -1 | 1) {
    setFields((prev) => {
      const index = prev.findIndex((field) => field.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = prev.slice();
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return renumberFields(next);
    });
  }

  function handleAnswerChange(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setSubmitted(false);
    setMissingIds((prev) => prev.filter((missingId) => missingId !== id));
  }

  function handleCheckAnswers() {
    const missing = includedFields
      .filter(
        (field) => field.required && (answers[field.id] ?? "").trim() === "",
      )
      .map((field) => field.id);
    setMissingIds(missing);
    setSubmitted(true);
  }

  function handleClearAnswers() {
    setAnswers({});
    setMissingIds([]);
    setSubmitted(false);
  }

  // Highlight: click a field in the list and its box lights up on the page.
  // The preview shows one page at a time, so selecting a field on
  // another page flips the preview to that page.
  function handleFieldSelect(id: string) {
    setSelectedFieldId(id);
    const field = fields.find((f) => f.id === id);
    if (field) setPreviewPage(field.page);
  }

  // Slice 5: generate the filled PDF (original + answers on the blanks).
  async function makeFilledPdfBlob(): Promise<Blob | null> {
    if (!originalBytes) return null;
    setGenerating(true);
    setError(null);
    try {
      const bytes = await generateFilledPdf(
        originalBytes,
        includedFields,
        answers,
      );
      // pdf-lib returns a Uint8Array; copy it into a fresh Blob part
      // so the bytes are not tied to a larger buffer.
      const copy = new Uint8Array(bytes.length);
      copy.set(bytes);
      return new Blob([copy], { type: "application/pdf" });
    } catch (err) {
      setError(
        err instanceof Error
          ? `Could not generate the filled PDF: ${err.message}`
          : "Could not generate the filled PDF.",
      );
      return null;
    } finally {
      setGenerating(false);
    }
  }

  async function handleDownloadFilledPdf() {
    const blob = await makeFilledPdfBlob();
    if (!blob || !fileName) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.pdf$/i, "") + "-filled.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handlePrintFilledPdf() {
    const blob = await makeFilledPdfBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    // Open the filled PDF in a new tab — print it from there (Ctrl+P).
    window.open(url, "_blank");
  }

  // The field list only shows the page being previewed.
  const pageFields = fields.filter((field) => field.page === previewPage);
  const pageIncludedCount = pageFields.filter(
    (field) => field.included,
  ).length;

  // Group the page's fields by section heading
  // ("STUDENT INFORMATION", "PARENT INFORMATION", ...).
  const groupedFields: { key: string; title: string; items: DetectedField[] }[] =
    [];
  for (const field of pageFields) {
    const title = field.group ?? `Page ${field.page}`;
    const key = `${field.page}|${field.group}`;
    const existing = groupedFields.find((g) => g.key === key);
    if (existing) existing.items.push(field);
    else groupedFields.push({ key, title, items: [field] });
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
          <>
            <div
              className="mb-6 flex gap-2"
              role="tablist"
              aria-label="FillForm views"
            >
              <button
                type="button"
                role="tab"
                aria-selected={view === "setup"}
                onClick={() => setView("setup")}
                className={`rounded-md px-4 py-2 text-sm font-medium ${
                  view === "setup"
                    ? "bg-blue-700 text-white"
                    : "border border-gray-300 bg-white hover:bg-gray-100"
                }`}
              >
                1. Setup fields
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "fill"}
                onClick={() => setView("fill")}
                className={`rounded-md px-4 py-2 text-sm font-medium ${
                  view === "fill"
                    ? "bg-blue-700 text-white"
                    : "border border-gray-300 bg-white hover:bg-gray-100"
                }`}
              >
                2. Fill form
              </button>
            </div>

            {view === "fill" ? (
              <FillForm
                fields={includedFields}
                answers={answers}
                missingIds={missingIds}
                submitted={submitted}
                generating={generating}
                canGenerate={submitted && missingIds.length === 0}
                pdf={pdf}
                pageCount={pageCount}
                onAnswerChange={handleAnswerChange}
                onSubmit={handleCheckAnswers}
                onClearAnswers={handleClearAnswers}
                onDownload={handleDownloadFilledPdf}
                onPrint={handlePrintFilledPdf}
              />
            ) : (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
                <div className="space-y-6">
                  <p className="text-sm text-gray-600">
                    <span className="font-medium text-gray-900">
                      {fileName}
                    </span>
                    {" — "}
                    {pageCount} {pageCount === 1 ? "page" : "pages"}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewPage((p) => Math.max(1, p - 1))
                      }
                      disabled={previewPage <= 1}
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-100 disabled:opacity-40"
                    >
                      ← Previous
                    </button>
                    <label className="flex items-center gap-1 text-sm text-gray-700">
                      Page
                      <select
                        value={previewPage}
                        aria-label="Preview page"
                        onChange={(e) =>
                          setPreviewPage(Number(e.target.value))
                        }
                        className="rounded border border-gray-300 px-2 py-1 text-sm"
                      >
                        {Array.from(
                          { length: pageCount },
                          (_, i) => i + 1,
                        ).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                      of {pageCount}
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setPreviewPage((p) => Math.min(pageCount, p + 1))
                      }
                      disabled={previewPage >= pageCount}
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-100 disabled:opacity-40"
                    >
                      Next →
                    </button>
                    <button
                      type="button"
                      onClick={handleRedetect}
                      disabled={detecting}
                      title="Run detection again on this PDF with the current code — use it after an update that improves detection"
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-100 disabled:opacity-40"
                    >
                      {detecting ? "Detecting…" : "Re-detect fields"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddMode((v) => !v)}
                      aria-pressed={addMode}
                      title="Turn on to add a field by clicking the page — plain clicks do nothing while it is off"
                      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                        addMode
                          ? "bg-blue-700 text-white hover:bg-blue-800"
                          : "border border-gray-300 bg-white hover:bg-gray-100"
                      }`}
                    >
                      {addMode ? "✓ Adding… click page" : "+ Add field"}
                    </button>
                  </div>
                  {addMode && (
                    <p className="text-sm text-blue-700">
                      Click the page where the new field goes — it will be
                      selected right away so you can drag and resize it.
                      Click “+ Add field” again to stop.
                    </p>
                  )}
                  <div ref={previewWrapRef}>
                    <PdfPage
                      key={previewPage}
                      pdf={pdf}
                      pageNumber={previewPage}
                      pageCount={pageCount}
                      onPageClick={addMode ? handlePageClick : undefined}
                      fields={fields}
                      selectedFieldId={selectedFieldId}
                      onFieldSelect={handleFieldSelect}
                      onFieldUpdate={updateField}
                    />
                  </div>
                </div>

                <aside
                  className="flex flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:sticky lg:top-6"
                  style={
                    fieldsCollapsed || !previewHeight
                      ? undefined
                      : { height: previewHeight }
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-base font-semibold">
                      Detected fields
                    </h2>
                    <button
                      type="button"
                      onClick={() => setFieldsCollapsed((v) => !v)}
                      aria-expanded={!fieldsCollapsed}
                      className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100"
                    >
                      {fieldsCollapsed ? "▸ Show" : "▾ Hide"}
                    </button>
                  </div>
                  {!fieldsCollapsed && (
                    <>
                      {detecting ? (
                        <p className="mt-2 text-sm text-gray-500">
                          Detecting blanks…
                        </p>
                      ) : pageFields.length > 0 ? (
                        <>
                          <p className="mt-1 text-sm text-gray-600">
                            {pageIncludedCount}{" "}
                            {pageIncludedCount === 1 ? "field" : "fields"} on
                            page {previewPage}
                            {" · "}
                            {fields.length} total
                          </p>
                          <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
                            {groupedFields.map((group) => (
                        <div key={group.key} className="mt-4">
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            {group.title}
                          </h3>
                          <ol className="mt-2 space-y-3">
                            {group.items.map((field) => (
                              <li
                                key={field.id}
                                onClick={() => handleFieldSelect(field.id)}
                                className={`cursor-pointer rounded-md border px-3 py-2 ${field.included ? "" : "opacity-50"} ${
                                  selectedFieldId === field.id
                                    ? "border-blue-600 bg-blue-50"
                                    : "border-gray-200"
                                }`}
                              >
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-500">
                                {field.order}.
                              </span>
                              <input
                                type="text"
                                value={field.label}
                                aria-label={`Field ${field.order} label`}
                                onChange={(e) =>
                                  updateField(field.id, {
                                    label: e.target.value,
                                  })
                                }
                                className={`min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm font-medium ${field.included ? "" : "line-through"}`}
                              />
                              <span className="shrink-0 text-xs text-gray-500">
                                Page {field.page}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <select
                                value={field.type}
                                aria-label={`Field ${field.order} type`}
                                onChange={(e) =>
                                  updateField(field.id, {
                                    type: e.target.value as FieldType,
                                  })
                                }
                                className="rounded border border-gray-300 px-2 py-1 text-sm"
                              >
                                <option value="text">Text</option>
                                <option value="textarea">Long text</option>
                                <option value="date">Date</option>
                                <option value="number">Number</option>
                                <option value="checkbox">Checkbox</option>
                              </select>
                              <label className="flex items-center gap-1 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={field.required}
                                  onChange={(e) =>
                                    updateField(field.id, {
                                      required: e.target.checked,
                                    })
                                  }
                                />
                                Required
                              </label>
                              <label className="flex items-center gap-1 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={field.included}
                                  onChange={(e) =>
                                    updateField(field.id, {
                                      included: e.target.checked,
                                    })
                                  }
                                />
                                Include
                              </label>
                            </div>
                            {field.type !== "checkbox" && (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="text-xs font-medium text-gray-500">
                                  Font
                                </span>
                                <select
                                  value={getFieldFont(field).family}
                                  aria-label={`Field ${field.order} font family`}
                                  onChange={(e) =>
                                    updateField(field.id, {
                                      fontFamily:
                                        e.target.value as FontFamilyId,
                                    })
                                  }
                                  className="rounded border border-gray-300 px-2 py-1 text-sm"
                                >
                                  {FONT_FAMILIES.map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {f.label}
                                    </option>
                                  ))}
                                </select>
                                <label className="flex items-center gap-1 text-sm text-gray-700">
                                  <input
                                    type="number"
                                    min="7"
                                    max="24"
                                    step="0.5"
                                    value={getFieldFont(field).size}
                                    aria-label={`Field ${field.order} font size`}
                                    onChange={(e) => {
                                      const parsed = parseFloat(
                                        e.target.value,
                                      );
                                      if (
                                        Number.isFinite(parsed) &&
                                        parsed >= 7 &&
                                        parsed <= 24
                                      ) {
                                        // A bigger font needs a
                                        // taller box (font size +
                                        // padding is the minimum).
                                        updateField(field.id, {
                                          fontSize: parsed,
                                          height: Math.max(
                                            field.height,
                                            parsed + 4,
                                          ),
                                        });
                                      }
                                    }}
                                    className="w-16 rounded border border-gray-300 px-1 py-1 text-sm"
                                  />
                                  pt
                                </label>
                                <label className="flex items-center gap-1 text-sm text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={getFieldFont(field).bold}
                                    onChange={(e) =>
                                      updateField(field.id, {
                                        bold: e.target.checked,
                                      })
                                    }
                                  />
                                  <span className="font-bold">B</span>
                                </label>
                                <label className="flex items-center gap-1 text-sm text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={getFieldFont(field).italic}
                                    onChange={(e) =>
                                      updateField(field.id, {
                                        italic: e.target.checked,
                                      })
                                    }
                                  />
                                  <span className="italic">I</span>
                                </label>
                              </div>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                              {(
                                [
                                  ["X", field.x],
                                  ["Y", field.y],
                                  ["W", field.width],
                                  ["H", field.height],
                                ] as const
                              ).map(([key, value]) => (
                                <label
                                  key={key}
                                  className="flex items-center gap-1"
                                >
                                  {key}
                                  <input
                                    type="number"
                                    step="1"
                                    value={Math.round(value * 10) / 10}
                                    aria-label={`Field ${field.order} ${key}`}
                                    onChange={(e) => {
                                      const parsed = parseFloat(
                                        e.target.value,
                                      );
                                      if (Number.isFinite(parsed)) {
                                        updateField(field.id, {
                                          [key.toLowerCase()]:
                                            parsed,
                                        } as Partial<DetectedField>);
                                      }
                                    }}
                                    className="w-16 rounded border border-gray-300 px-1 py-0.5 text-xs"
                                  />
                                </label>
                              ))}
                              <span className="text-gray-400">
                                pt from bottom-left
                              </span>
                            </div>
                            <div className="mt-2 flex items-center gap-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveField(field.id, -1);
                                }}
                                disabled={fields.indexOf(field) === 0}
                                aria-label={`Move field ${field.order} up`}
                                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40"
                              >
                                ↑ Up
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  moveField(field.id, 1);
                                }}
                                disabled={
                                  fields.indexOf(field) === fields.length - 1
                                }
                                aria-label={`Move field ${field.order} down`}
                                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40"
                              >
                                ↓ Down
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteField(field.id);
                                }}
                                aria-label={`Delete field ${field.order}`}
                                className="ml-auto rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                              >
                                Delete
                              </button>
                            </div>
                              </li>
                            ))}
                          </ol>
                        </div>
                      ))}
                          </div>
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-gray-500">
                          No fields on this page — turn on “+ Add field”
                          and click on the page to add
                          one.
                        </p>
                      )}
                      <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
                        Tip: click a field to highlight it on the page. Drag
                        the highlighted box to move it, drag its corners to
                        resize it, or type the exact X / Y / W / H above.
                        Click on a page to add a field at that spot.
                      </p>
                    </>
                  )}
                </aside>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
