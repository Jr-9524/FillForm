import type { DetectedField } from '../lib/fields'

type FillFormProps = {
  fields: DetectedField[]
  answers: Record<string, string>
  missingIds: string[]
  submitted: boolean
  generating: boolean
  canGenerate: boolean
  onAnswerChange: (id: string, value: string) => void
  onSubmit: () => void
  onClearAnswers: () => void
  onDownload: () => void
  onPrint: () => void
}

/**
 * Slice 3: clean fill form, in document order.
 * Only included fields are shown. No PDF preview, no editor here —
 * the filler just answers, top to bottom.
 */
export function FillForm({
  fields,
  answers,
  missingIds,
  submitted,
  generating,
  canGenerate,
  onAnswerChange,
  onSubmit,
  onClearAnswers,
  onDownload,
  onPrint,
}: FillFormProps) {
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
    <form
      className="mx-auto max-w-2xl rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
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
                  className="h-5 w-5 accent-blue-700"
                />
              ) : field.type === 'textarea' ? (
                <textarea
                  id={inputId}
                  value={value}
                  rows={3}
                  onChange={(e) => onAnswerChange(field.id, e.target.value)}
                  className={commonClass}
                />
              ) : (
                <input
                  id={inputId}
                  type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
                  value={value}
                  onChange={(e) => onAnswerChange(field.id, e.target.value)}
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
  )
}
