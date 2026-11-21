import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { PdfPage } from './components/PdfPage'
import { FillForm } from './components/FillForm'
import pdfjsLib from './lib/pdfjs'
import { detectFields } from './lib/detectFields'
import { createManualField, renumberFields, sortAndOrderFields } from './lib/fields'
import type { DetectedField, FieldType } from './lib/fields'

type View = 'setup' | 'fill'

/**
 * FillForm — Slice 3: scaffold + PDF upload + preview + blank detection
 * + field editor + fill form (document order, required validation,
 * answers saved in localStorage).
 *
 * No sharing, no PDF overlay yet.
 * Those are later slices (see BUILD_PLAN.md).
 */
function App() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [fields, setFields] = useState<DetectedField[]>([])
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('setup')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [missingIds, setMissingIds] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // pdf.js v6 destroys a document through its loading task, not the proxy.
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null)
  // Guards against a slow detection run overwriting a newer upload.
  const detectionRunRef = useRef(0)

  const includedFields = fields.filter((field) => field.included)

  // Slice 3: save answers in this browser, keyed by file name.
  // Detection ids are deterministic for the same PDF, so a re-upload
  // restores the same answers.
  useEffect(() => {
    if (!fileName) return
    try {
      localStorage.setItem(
        `fillform-answers:${fileName}`,
        JSON.stringify(answers),
      )
    } catch {
      // Storage full or unavailable — answers still work in memory.
    }
  }, [answers, fileName])

  function loadSavedAnswers(name: string) {
    try {
      const raw = localStorage.getItem(`fillform-answers:${name}`)
      if (!raw) return {}
      const parsed: unknown = JSON.parse(raw)
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, string>)
        : {}
    } catch {
      return {}
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a PDF file.')
      return
    }

    setLoading(true)
    setError(null)
    // Destroy the previous document so a new upload starts clean.
    await loadingTaskRef.current?.destroy()
    loadingTaskRef.current = null
    setPdf(null)
    setPageCount(0)
    setFields([])
    setView('setup')
    setAnswers(loadSavedAnswers(file.name))
    setMissingIds([])
    setSubmitted(false)

    try {
      const data = await file.arrayBuffer()
      const loadingTask = pdfjsLib.getDocument({ data })
      loadingTaskRef.current = loadingTask
      const doc = await loadingTask.promise
      setFileName(file.name)
      setPdf(doc)
      setPageCount(doc.numPages)

      // Slice 1: detect blanks now that the document is loaded.
      const runId = ++detectionRunRef.current
      setDetecting(true)
      try {
        const detected = await detectFields(doc)
        if (detectionRunRef.current === runId) setFields(detected)
      } catch (detectErr) {
        if (detectionRunRef.current === runId) {
          setError(
            detectErr instanceof Error
              ? `Could not detect blanks: ${detectErr.message}`
              : 'Could not detect blanks.',
          )
        }
      } finally {
        if (detectionRunRef.current === runId) setDetecting(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open this PDF.')
    } finally {
      setLoading(false)
    }
  }

  async function clearFile() {
    detectionRunRef.current++
    await loadingTaskRef.current?.destroy()
    loadingTaskRef.current = null
    setPdf(null)
    setPageCount(0)
    setFileName(null)
    setFields([])
    setDetecting(false)
    setError(null)
    setView('setup')
    setAnswers({})
    setMissingIds([])
    setSubmitted(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  function handlePageClick(pageNumber: number, x: number, y: number) {
    const label = window.prompt('Field label:', 'Field')
    if (label === null) return
    const trimmed = label.trim() || 'Field'
    setFields((prev) =>
      sortAndOrderFields([...prev, createManualField(pageNumber, x, y, trimmed)]),
    )
  }

  // Slice 2: field editor helpers.
  function updateField(id: string, patch: Partial<DetectedField>) {
    setFields((prev) =>
      prev.map((field) => (field.id === id ? { ...field, ...patch } : field)),
    )
  }

  function deleteField(id: string) {
    setFields((prev) => renumberFields(prev.filter((field) => field.id !== id)))
  }

  function moveField(id: string, direction: -1 | 1) {
    setFields((prev) => {
      const index = prev.findIndex((field) => field.id === id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return renumberFields(next)
    })
  }

  // Slice 3: fill form helpers.
  function handleAnswerChange(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }))
    setSubmitted(false)
    setMissingIds((prev) => prev.filter((missingId) => missingId !== id))
  }

  function handleCheckAnswers() {
    const missing = includedFields
      .filter(
        (field) => field.required && (answers[field.id] ?? '').trim() === '',
      )
      .map((field) => field.id)
    setMissingIds(missing)
    setSubmitted(true)
  }

  function handleClearAnswers() {
    setAnswers({})
    setMissingIds([])
    setSubmitted(false)
  }

  const includedCount = includedFields.length
  const excludedCount = fields.length - includedCount

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
              {pdf ? 'Upload a different PDF' : 'Upload PDF'}
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
          <p role="alert" className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
            <div className="mb-6 flex gap-2" role="tablist" aria-label="FillForm views">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'setup'}
                onClick={() => setView('setup')}
                className={`rounded-md px-4 py-2 text-sm font-medium ${
                  view === 'setup'
                    ? 'bg-blue-700 text-white'
                    : 'border border-gray-300 bg-white hover:bg-gray-100'
                }`}
              >
                1. Setup fields
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'fill'}
                onClick={() => setView('fill')}
                className={`rounded-md px-4 py-2 text-sm font-medium ${
                  view === 'fill'
                    ? 'bg-blue-700 text-white'
                    : 'border border-gray-300 bg-white hover:bg-gray-100'
                }`}
              >
                2. Fill form
              </button>
            </div>

            {view === 'fill' ? (
              <FillForm
                fields={includedFields}
                answers={answers}
                missingIds={missingIds}
                submitted={submitted}
                onAnswerChange={handleAnswerChange}
                onSubmit={handleCheckAnswers}
                onClearAnswers={handleClearAnswers}
              />
            ) : (
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
                <div className="space-y-6">
                  <p className="text-sm text-gray-600">
                    <span className="font-medium text-gray-900">{fileName}</span>
                    {' — '}
                    {pageCount} {pageCount === 1 ? 'page' : 'pages'}
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
                        {includedCount} {includedCount === 1 ? 'field' : 'fields'} found
                        {excludedCount > 0 && (
                          <>
                            {' · '}
                            {excludedCount} excluded
                          </>
                        )}
                      </p>
                      <ol className="mt-3 space-y-3">
                        {fields.map((field, index) => (
                          <li
                            key={field.id}
                            className={`rounded-md border border-gray-200 px-3 py-2 ${field.included ? '' : 'opacity-50'}`}
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
                                  updateField(field.id, { label: e.target.value })
                                }
                                className={`min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm font-medium ${field.included ? '' : 'line-through'}`}
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
                              </select>
                              <label className="flex items-center gap-1 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={field.required}
                                  onChange={(e) =>
                                    updateField(field.id, { required: e.target.checked })
                                  }
                                />
                                Required
                              </label>
                              <label className="flex items-center gap-1 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={field.included}
                                  onChange={(e) =>
                                    updateField(field.id, { included: e.target.checked })
                                  }
                                />
                                Include
                              </label>
                            </div>
                            <div className="mt-2 flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => moveField(field.id, -1)}
                                disabled={index === 0}
                                aria-label={`Move field ${field.order} up`}
                                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40"
                              >
                                ↑ Up
                              </button>
                              <button
                                type="button"
                                onClick={() => moveField(field.id, 1)}
                                disabled={index === fields.length - 1}
                                aria-label={`Move field ${field.order} down`}
                                className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40"
                              >
                                ↓ Down
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteField(field.id)}
                                aria-label={`Delete field ${field.order}`}
                                className="ml-auto rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                              >
                                Delete
                              </button>
                            </div>
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
          </>
        )}
      </main>
    </div>
  )
}

export default App
