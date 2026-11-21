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
 * see is what you get. The preview follows the field being filled.
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
  const filledCount = fields.filter(
    (field) => (answers[field.id] ?? '').trim() !== '',
  ).length

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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
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
          />
          <p className="text-xs text-gray-500">
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
      <p className="text-sm text-gray-600">
        {filledCount} of {fields.length} filled
      </p>

      {missingIds.length > 0 && (
        <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Please fill in the required fields marked below.
        </p>
      )}

      {submitted && missingIds.length === 0 && (
        <p role="status" className="mt-3 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          All required fields are filled. You can download or print the
          filled PDF now.
        </p>
      )}

      <div className="mt-5 space-y-5">
        {fields.map((field) => {
          const isMissing = missingIds.includes(field.id)
          const value = answers[field.id] ?? ''
          const inputId = `fill-${field.id}`
          const commonClass = `w-full rounded border px-3 py-2 text-sm ${
            isMissing
              ? 'border-red-500'
              : 'border-gray-300'
          }`
          return (
            <div key={field.id}>
              <label htmlFor={inputId} className="block text-sm font-medium">
                {field.order}. {field.label}
                {field.required && (
                  <span className="text-red-600"> *</span>
                )}
                <span className="ml-2 font-normal text-gray-500">
                  Page {field.page}
                </span>
              </label>
              {field.type === 'checkbox' ? (
                <input
                  id={inputId}
                  type="checkbox"
                  checked={value === 'true'}
                  onChange={(e) =>
                    onAnswerChange(field.id, e.target.checked ? 'true' : '')
                  }
                  onFocus={() => setPreviewPage(field.page)}
                  className="h-5 w-5 accent-blue-700"
                />
              ) : field.type === 'textarea' ? (
                <textarea
                  id={inputId}
                  value={value}
                  rows={Math.max(
                    3,
                    Math.min(10, Math.round(field.height / 24)),
                  )}
                  onChange={(e) => onAnswerChange(field.id, e.target.value)}
                  onFocus={() => setPreviewPage(field.page)}
                  className={commonClass}
                />
              ) : (
                <input
                  id={inputId}
                  type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
                  value={value}
                  onChange={(e) => onAnswerChange(field.id, e.target.value)}
                  onFocus={() => setPreviewPage(field.page)}
                  className={commonClass}
                />
              )}
              {isMissing && (
                <p className="mt-1 text-xs text-red-600">
                  This field is required.
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="submit"
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800"
        >
          Check answers
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={!canGenerate || generating}
          className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-40"
        >
          {generating ? 'Generating…' : 'Download filled PDF'}
        </button>
        <button
          type="button"
          onClick={onPrint}
          disabled={!canGenerate || generating}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-40"
        >
          Print filled PDF
        </button>
        <button
          type="button"
          onClick={onClearAnswers}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-100"
        >
          Clear answers
        </button>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        {canGenerate
          ? 'Download gives you the original PDF with your answers on the blanks. Print opens it in a new tab — print from there (Ctrl+P).'
          : 'Fill the form and click “Check answers” first — download and print unlock once all required fields are filled.'}
      </p>
    </form>
    </div>
  )
}
