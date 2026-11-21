import { useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { DetectedField } from '../lib/fields'
import { PdfPage } from './PdfPage'

type FillFormProps = {
  fields: DetectedField[]
  answers: Record<string, string>
  missingIds: string[]
  submitted: boolean
  generating: boolean
  canGenerate: boolean
  pdf: PDFDocumentProxy | null
  pageCount: number
  onAnswerChange: (id: string, value: string) => void
  onSubmit: () => void
  onClearAnswers: () => void
  onDownload: () => void
  onPrint: () => void
}

/**
 * Slice 3 + live preview: the filler answers top to bottom, and the
 * page beside the form shows each answer on the blank as it is typed
 * — the same position and size the downloaded PDF uses, so what you
 * see is what you get. The preview follows the field being filled,
 * and the field being filled gets an outline on the preview.
 */
export function FillForm({
  fields,
  answers,
  missingIds,
  submitted,
  generating,
  canGenerate,
  pdf,
  pageCount,
  onAnswerChange,
  onSubmit,
  onClearAnswers,
  onDownload,
  onPrint,
}: FillFormProps) {
  const [previewPage, setPreviewPage] = useState(1)
  // Live-preview zoom (1 = fit the column).
  const [previewZoom, setPreviewZoom] = useState(1)
  // The list shows only the previewed page by default, so the form
  // follows the preview instead of one long 136-field scroll. "All
  // pages" shows everything, in document order.
  const [showAllPages, setShowAllPages] = useState(false)
  // The field the filler is currently answering — its box gets an
  // outline on the preview, and the preview scrolls to it.
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null)
  const visibleFields = showAllPages
    ? fields
    : fields.filter((field) => field.page === previewPage)
  const pageFieldCount = fields.filter(
    (field) => field.page === previewPage,
  ).length
  const filledCount = fields.filter(
    (field) => (answers[field.id] ?? '').trim() !== '',
  ).length
  const emptyCount = fields.length - filledCount
  // Missing fields that are not on the previewed page (and so not
  // visible in the filtered list) — the sticky bar says so.
  const missingOffPage = missingIds.filter((id) => {
    const field = fields.find((f) => f.id === id)
    return field && field.page !== previewPage
  }).length
  // Whether any field is marked Required in Setup: when none is,
  // "Check answers" counts every included field instead, so the
  // check is never vacuous (see App.handleCheckAnswers).
  const hasRequired = fields.some((field) => field.required)
  // How many times each label appears in the visible list — a
  // repeated label gets its section shown next to it.
  const labelCounts = new Map<string, number>()
  for (const field of visibleFields) {
    labelCounts.set(field.label, (labelCounts.get(field.label) ?? 0) + 1)
  }
  // Group the visible fields under their section headings, in
  // document order. In "All pages" mode the same section name on
  // different pages stays separate ("Page N · Section").
  const sections: { key: string; heading: string; fields: DetectedField[] }[] =
    []
  for (const field of visibleFields) {
    const key = `${field.page}|${field.group || 'General'}`
    const heading = showAllPages
      ? `Page ${field.page} · ${field.group || 'General'}`
      : field.group || 'General'
    const last = sections[sections.length - 1]
    if (last && last.key === key) {
      last.fields.push(field)
    } else {
      sections.push({ key, heading, fields: [field] })
    }
  }

  if (fields.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-lg font-medium">No fields to fill</p>
        <p className="mt-1 text-sm text-gray-500">
          All fields are excluded, or none were detected. Go back to Setup
          and include at least one field.
        </p>
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start">
      {pdf && (
        <div className="order-2 space-y-4 lg:order-1">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
              disabled={previewPage <= 1}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-40"
            >
              ← Previous
            </button>
            <button
              type="button"
              onClick={() =>
                setPreviewPage((p) => Math.min(pageCount, p + 1))
              }
              disabled={previewPage >= pageCount}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-100 disabled:opacity-40"
            >
              Next →
            </button>
            <select
              value={previewPage}
              onChange={(e) => setPreviewPage(Number(e.target.value))}
              aria-label="Preview page"
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
            >
              {Array.from({ length: pageCount }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Page {i + 1} of {pageCount}
                </option>
              ))}
            </select>
          </div>
          <PdfPage
            pdf={pdf}
            pageNumber={previewPage}
            pageCount={pageCount}
            fields={fields}
            answers={answers}
            showAnswers
            highlightFieldId={activeFieldId}
            zoom={previewZoom}
            onZoomChange={setPreviewZoom}
          />
          <p className="text-xs text-gray-600">
            Live preview — your answers appear on the page as you type,
            exactly where the download puts them.
          </p>
        </div>
      )}
    <form
      className="order-1 rounded-lg border border-gray-200 bg-white p-6 shadow-sm lg:order-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">
          {filledCount} of {fields.length} answered
        </p>
        <p className="text-xs text-gray-600">
          {showAllPages ? 'All pages' : `Page ${previewPage}`}
        </p>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-valuenow={filledCount}
        aria-valuemin={0}
        aria-valuemax={fields.length}
        aria-label={`${filledCount} of ${fields.length} answered`}
      >
        <div
          className="h-full rounded-full bg-blue-700 transition-all"
          style={{
            width: `${fields.length > 0 ? (filledCount / fields.length) * 100 : 0}%`,
          }}
        />
      </div>
      {!hasRequired && (
        <p className="mt-2 text-xs text-gray-600">
          No fields are marked Required, so all fields count.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Which fields to show">
        <button
          type="button"
          onClick={() => setShowAllPages(false)}
          aria-pressed={!showAllPages}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            !showAllPages
              ? "bg-blue-700 text-white"
              : "border border-gray-300 bg-white hover:bg-gray-100"
          }`}
        >
          This page ({pageFieldCount})
        </button>
        <button
          type="button"
          onClick={() => setShowAllPages(true)}
          aria-pressed={showAllPages}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            showAllPages
              ? "bg-blue-700 text-white"
              : "border border-gray-300 bg-white hover:bg-gray-100"
          }`}
        >
          All pages ({fields.length})
        </button>
      </div>

      {/* Bottom padding keeps the sticky footer from covering the
          last field when the list is scrolled to the end. */}
      <div className="mt-5 space-y-6 pb-32">
        {sections.map((section) => (
          <fieldset key={section.key}>
            <legend className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {section.heading}
            </legend>
            <div className="space-y-5">
              {section.fields.map((field) => {
                const isMissing = missingIds.includes(field.id)
                const value = answers[field.id] ?? ''
                const inputId = `fill-${field.id}`
                const showSection =
                  (labelCounts.get(field.label) ?? 0) > 1 && field.group
                const commonClass = `w-full rounded border px-3 py-2 text-sm ${
                  isMissing ? 'border-red-500' : 'border-gray-300'
                }`
                const focusField = () => {
                  setActiveFieldId(field.id)
                  setPreviewPage(field.page)
                }
                if (field.type === 'checkbox') {
                  return (
                    <div key={field.id}>
                      <label
                        htmlFor={inputId}
                        className="flex cursor-pointer items-center gap-2 text-sm font-medium"
                      >
                        <input
                          id={inputId}
                          type="checkbox"
                          checked={value === 'true'}
                          onChange={(e) =>
                            onAnswerChange(
                              field.id,
                              e.target.checked ? 'true' : '',
                            )
                          }
                          onFocus={focusField}
                          className="h-5 w-5 shrink-0 accent-blue-700"
                        />
                        <span>
                          {field.order}. {field.label}
                          {field.required && (
                            <span className="text-red-600"> *</span>
                          )}
                          {showSection && (
                            <span className="ml-2 font-normal text-gray-500">
                              {field.group}
                            </span>
                          )}
                        </span>
                      </label>
                      {isMissing && (
                        <p className="mt-1 text-xs text-red-600">
                          {field.required
                            ? 'This field is required.'
                            : 'This field is empty — fill it in before downloading.'}
                        </p>
                      )}
                    </div>
                  )
                }
                return (
                  <div key={field.id}>
                    <label
                      htmlFor={inputId}
                      className="block text-sm font-medium"
                    >
                      {field.order}. {field.label}
                      {field.required && (
                        <span className="text-red-600"> *</span>
                      )}
                      {showSection && (
                        <span className="ml-2 font-normal text-gray-500">
                          {field.group}
                        </span>
                      )}
                    </label>
                    {field.type === 'textarea' ? (
                      <textarea
                        id={inputId}
                        value={value}
                        rows={Math.max(
                          3,
                          Math.min(10, Math.round(field.height / 24)),
                        )}
                        onChange={(e) =>
                          onAnswerChange(field.id, e.target.value)
                        }
                        onFocus={focusField}
                        className={commonClass}
                      />
                    ) : (
                      <input
                        id={inputId}
                        type={
                          field.type === 'date'
                            ? 'date'
                            : field.type === 'number'
                              ? 'number'
                              : 'text'
                        }
                        value={value}
                        onChange={(e) =>
                          onAnswerChange(field.id, e.target.value)
                        }
                        onFocus={focusField}
                        className={commonClass}
                      />
                    )}
                    {isMissing && (
                      <p className="mt-1 text-xs text-red-600">
                        {field.required
                          ? 'This field is required.'
                          : 'This field is empty — fill it in before downloading.'}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>

      {/* Sticky action bar: the buttons and the check result stay
          visible while scrolling the list, so the feedback is where
          the user is — not at the top of a 136-field form. */}
      <div className="sticky bottom-0 -mx-6 mt-6 border-t border-gray-200 bg-white px-6 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
        {missingIds.length > 0 && (
          <p role="alert" className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {missingIds.length} {missingIds.length === 1 ? 'field' : 'fields'} still empty — {hasRequired ? 'the required ones are marked below.' : 'fill them in below.'}
            {!showAllPages && missingOffPage > 0 && (
              <> {missingOffPage} {missingOffPage === 1 ? 'is' : 'are'} on other pages — switch to “All pages” to see {missingOffPage === 1 ? 'it' : 'them'}.</>
            )}
          </p>
        )}

        {submitted && missingIds.length === 0 && (
          <p role="status" className="mb-3 rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
            {filledCount} of {fields.length} answered.
            {emptyCount > 0
              ? ` ${emptyCount} ${emptyCount === 1 ? 'field is' : 'fields are'} still empty, but none ${emptyCount === 1 ? 'is' : 'are'} required — you can download or print now.`
              : ' You can download or print the filled PDF now.'}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
          >
            Review answers
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={!canGenerate || generating}
            className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generating ? 'Generating…' : 'Download filled PDF'}
          </button>
          <button
            type="button"
            onClick={onPrint}
            disabled={!canGenerate || generating}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Print filled PDF
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  'Clear all answers? The fields stay — only what you typed is removed.',
                )
              ) {
                onClearAnswers()
              }
            }}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-100"
          >
            Clear answers
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-600">
          {canGenerate
            ? 'Download gives you the original PDF with your answers on the blanks. Print opens it in a new tab — print from there (Ctrl+P).'
            : 'Fill the form and click “Review answers” first — download and print unlock once the fields that count are filled.'}
        </p>
      </div>
    </form>
    </div>
  )
}
