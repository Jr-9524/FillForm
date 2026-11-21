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

## Detection upgrade (2026-11-21, after Slice 5)

- Checkboxes: `☐` / `□` in the PDF become checkbox fields. The fill
  form shows a tick box; the filled PDF gets an X in the box.
- Section groups: ALL-CAPS headings ("STUDENT INFORMATION",
  "PARENT INFORMATION", ...) group the field list by page and section.
- Column-aware blanks: a label whose next text is in another column
  (e.g. "Sex:", "Contact Number:") now gets a blank to the end of its
  own column instead of being dropped. Group headers ("Support Areas…",
  "Purpose of Meeting:") and wrapped-label lines are skipped.
- Highlight: click a field in the list and its box lights up on the
  PDF page (and vice versa — click a box on the page to select it).
- Overlay spacing: answers are drawn 4pt to the right of the label,
  so they no longer stick to the colon ("Student Name: awd").

## Vector-line detection (2026-11-21, alignment fix)

The blanks in a form are drawn lines, so detection now reads them
straight from the PDF (pdf.js operator list): a field snaps to the
drawn line's exact position and length, instead of guessing a width
from the text gap. That fixes the highlight alignment and finds
blanks the text rules missed:

- Same-row lines: the box sits exactly on the underline, at its real
  length (no more 200pt boxes running to the column edge).
- Below-label lines: blanks that sit under their label ("School of
  Attendance:", "School Address:", "Contact Number:") are now found.
- Drawn checkboxes: vector squares (e.g. the Meeting options) become
  checkbox fields, with the label to their right.
- Wrapped labels are joined ("Date of Initial Meeting to Determine
  Eligibility", "Graphic organizers for writing").
- Checkbox options with no blank ("☐ Therapy Services:") no longer
  get a phantom text field — just the checkbox.
- The highlight box straddles the blank line instead of floating
  above it. On the IEP: 113 fields (was 72), page 1 is 40.
- Fallback: forms with no drawn lines still use the text gap/column
  rules. Scanned/image-only PDFs still need OCR (a later stretch,
  not V1).

## Textarea boxes (2026-11-21, after the alignment fix)

Big empty boxes (writing areas) are detected as textarea fields,
not thin single-line strips:

- Drawn rectangles (60pt+ wide, 18–200pt tall) are read from the
  PDF's vector paths; section frames that contain other boxes are
  excluded.
- The box is claimed by its lowest label that has no blank yet —
  the label can end with ":" or not ("Student's Strengths,
  Preferences & Interests" has no colon). The textarea runs from
  just below that label to the next label below it (or the box
  bottom), so it never covers other labels ("Measurable Annual Goal
  1" stops above "Person Responsible:").
- On the IEP: all 8 Present Levels boxes, the goal-table cells
  (Area of need, Baseline, Annual Goal, Short-term objectives,
  Progress Reports, Comment) — 119 fields total (was 113).
- The fill form shows a real multi-line box (rows sized to the box),
  and the filled PDF word-wraps the answer inside the box,
  shrinking the font if needed.

## Adjustable boxes (2026-11-21)

Detection still misses some blanks (a label-less signature table,
a giant NOTES area), so any box can now be fixed by hand in Setup:

- Click a highlighted box to select it, then drag it to move it.
- Drag its corner handles to reshape it (width / height).
- Or type the exact X / Y / W / H (PDF points, from bottom-left)
  in the field editor.
- Click on a page to add a field at that spot, then drag/resize it
  to fit.
- Detection fixes in the same round: the ⬜ checkbox character
  (Parent Consent) is now detected, and long sentences ending in
  ":" ("The following individuals participated…") no longer become
  phantom fields. IEP is 120 fields (was 119).

## One page at a time (2026-11-21)

Setup used to stack every page under each other, which was confusing
on a long document. The preview now shows one page at a time, with
Previous / Next buttons and a page picker ("Page 3 of 9"). Clicking
a field in the list flips the preview to that field's page.

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
