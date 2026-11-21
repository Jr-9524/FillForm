# FillForm

Web app (V1, PDF-only) that turns a PDF softcopy into a fillable form:
upload a PDF, the app finds the blanks, builds a form in the same order
as the document, and the filled answers are placed back onto the original
PDF. No ML. DOCX comes after V1.

Full plan: `../softcopy-form-filler/BUILD_PLAN.md`

## Slice 0 — what works now

- Scaffold: React 19 + Vite + TypeScript + Tailwind CSS
- Upload a PDF file and preview it page by page (pdf.js, canvas render),
  with page numbers.

## Slice 1 — what works now

- Blank detection (no ML): underscore runs (`____`) and `Label:` with
  empty space after it, found via pdf.js `getTextContent()` positions.
  Fields are listed in document order (page, top-to-bottom, left-to-right)
  with a count, e.g. "12 fields found".
- If no blanks are found, the app says so — and you can click on a page
  to add a field manually (a prompt asks for its label).

## Slice 2 — what works now

- Field editor, in the "Detected fields" panel: rename each field's label,
  change its type (Text / Long text / Date / Number), mark it Required,
  uncheck Include to exclude it (excluded fields stay in the list, greyed
  out with a struck-through label, and are not counted in the field count),
  move it up/down (order is re-numbered), or delete it.
- Nothing else yet — no form, no sharing, no PDF overlay.

## Slice 3 — what works now

- "Fill form" view (tab 2, next to "Setup fields"): a clean form with
  only the included fields, in document order, one input per field —
  text, long text (textarea), date picker, or number input, matching
  the field type.
- "Check answers" validates required fields only: empty required fields
  are marked in red with "This field is required." and the form is not
  accepted until they are filled.
- Answers are saved in the browser (localStorage, keyed by file name)
  and restored when the same PDF is uploaded again. "Clear answers"
  wipes them.
- Nothing else yet — no sharing, no PDF overlay / download.

## Slice 5 — what works now (sharing skipped for now)

- After "Check answers" passes (all required fields filled), two new
  buttons unlock in the Fill form view: "Download filled PDF" and
  "Print filled PDF".
- Download saves `<name>-filled.pdf`: the ORIGINAL PDF with answers
  drawn on top at the stored blank positions (pdf-lib, Helvetica 12pt,
  shrinking to 7pt if a long answer would run over the next label).
  Layout, fonts and logos are untouched.
- Print opens the filled PDF in a new tab — print from there (Ctrl+P).
- Sharing (Slice 4) is skipped for now, by the user's call.

## Run it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173).

## Build it

```bash
npm run build
```

## Tech

- React 19 + Vite + TypeScript + Tailwind CSS 4
- pdf.js (`pdfjs-dist`) for PDF preview
