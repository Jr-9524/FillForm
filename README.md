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

## Field panel (2026-11-21)

- The Detected fields panel only lists the page being previewed
  ("8 fields on page 2 · 120 total"), so the list stays short.
- It is collapsible (Show / Hide) and fixed to the previewed
  page's height — the list scrolls inside the panel instead of
  pushing the page down.

## Missed checkboxes fixed (2026-11-21)

Page 7 (Modifications) was only finding 13 of its 25 checkboxes.
The cause was a cross-page dedupe bug: the checkbox dedupe compared
positions without checking the page, and pages 6 and 7 lay their
checkboxes out on the same grid — so every page-7 square sitting
where a page-6 square sat was silently dropped (12 missed). Fixed
by scoping the dedupe to the page. Same round: split label
fragments are joined first ("R" + "educed", "Use" + "of
multiple-"), wrapped labels run to 3 continuation lines, a
continuation that belongs to the next option is never stolen
(it has its own square to the left), hyphenated splits join
without a space ("multiple-choice", "text-to-speech"), and tall
empty boxes are detected as textareas when they hold no squares,
labels, or writing lines — the "Additional Modifications" box on
page 7 is one now. A tall grid (the page-9 signature table) is
still not claimed. IEP is 136 fields (was 120).

## Live preview in Fill mode (2026-11-21)

The Fill view now shows the page beside the form, and every answer
appears on its blank as you type — same position, size, and
wrapping the downloaded PDF uses (12pt shrinking to 7pt to fit,
word-wrapped textareas, an X in checked boxes), so what you see is
what you get. The preview follows the field you are filling: click
into an answer and the page flips to that field's page. Same round:
the Setup highlight box for a text field now hugs the answer
(3pt below the line, the rest above) instead of sitting 5pt below
it, so the downloaded text no longer rides at the top of the box
and pokes out of it.

## Re-detect fields (2026-11-21)

Detection only ran when a PDF was uploaded, so after a pull that
improved detection the old boxes stayed on screen — the "School of
Attendance" box sat on the label row while its real blank is the
line below it. Setup now has a "Re-detect fields" button beside
the pager: it runs detection again on the loaded PDF with the
current code and replaces the fields (manual box tweaks are reset;
answers for fields that are still found are kept).

## Placeholder preview + Add field mode (2026-11-21)

Every Setup box shows a gray placeholder of what a filled answer
looks like, matched to the field's type: lorem ipsum for text
fields (long enough to run to the box's right edge), wrapped lorem
ipsum for textareas, a ✓ for checkboxes, a date (01/15/2026) for
dates, and 123 for numbers. Clicking the page no longer adds a
field by accident: Setup has a "+ Add field" button — only while
it is on does a page click add a field (the new field is selected
right away so it can be dragged and resized at once).

## Box sits on the line (2026-11-21)

Tested on the live Vercel site with the IEP: every detected text
box used to read as floating above its underline, and dragging a
box onto its line shifted the answer 3pt above it in the download.
The box used to straddle the line (3pt below it, the rest above),
so aligning its bottom edge with the line moved the baseline.
Now a text box sits ON its line — its bottom edge is the text
baseline (the drawn line), the way a text input sits on an
underline. Drag the box so its bottom edge is on the line and the
answer lands exactly on it, in the live preview and the download.
The single-line placeholder now hugs the bottom of the box too,
so the lorem ipsum sits on the line like a real answer; textareas
still start at the top. The Fill preview text is also nudged so
its baseline lands on the line (a lineHeight-1 Helvetica line puts
the baseline ~0.85em below the div top). Verified: all 21 text
fields on IEP page 1 have their box bottom exactly on their line,
and drag/resize round-trips exactly (0 failures). Detection is
unchanged (136 fields).

## Minimum height, padding + font editor (2026-11-21)

A text box is never shorter than its font size + 4pt of padding
(16pt at the default 12pt font), so the answer always fits with
room around it — resizing a box cannot shrink it below that, and a
bigger font grows the box. The answer also sits 4pt in from the
box's left and right edges, matching the download. The box bottom
is still the text baseline (the line), so the padding is above the
text and on the sides.

Each field (except checkboxes) has a Font row in the editor:
family (Helvetica, Times New Roman, or Courier), size (7–24pt),
Bold, and Italic. The choice shows in the Setup placeholder and
the Fill live preview, and the download draws the answer in that
font (pdf-lib's built-in StandardFonts, no font files needed) at
that size, shrinking to 7pt only if a long answer would not fit.
Changing the size grows the box to at least the new size + padding.
Fields created before the font editor existed default to
Helvetica 12pt regular. Verified: detection unchanged (136
fields), all text boxes render at least 16pt with their bottom
exactly on the line, and a Times Bold 14 + Courier 10 filled PDF
embeds Times-Bold and Courier with the answers in place.

## Setup panel fixes (2026-11-21)

**Undo.** Every field change (drag, resize, label/type/font edit,
move, delete, add, re-detect) pushes the field list onto a history
stack (capped at 50, one step per drag, not per pixel). Undo is
Ctrl+Z / Cmd+Z in Setup, or the ↩ Undo button in the toolbar.
Text inputs keep their own native undo. Delete now asks for
confirmation and mentions Ctrl+Z. A new upload or Clear resets the
history, so undo never restores fields from another document.

**List order.** The panel now lists the page's fields in document
order (field number), not grouped by section — Parent Information
no longer sits last. Each card shows its section as a small tag,
so duplicate labels ("Other" ×4, "Address" ×2) can be told apart.
The redundant "Page N" on every card is gone.

**Position.** X / Y / W / H are behind a "Position" disclosure per
card, so the card is shorter and more of them fit; values are
rounded to 1 decimal. Required is now "Required" with a tooltip,
Include is "Include in form" with a tooltip, and a one-line note
under the count explains the difference. B / I have Bold / Italic
tooltips. Re-detect now reports "Re-detected: N fields total" for
a few seconds after it runs, so it is clear it actually ran. The
Tip at the bottom of the panel was corrected (plain clicks do
nothing while Add mode is off; Ctrl+Z undoes).

## Big-3 UI/UX fixes (2026-11-21)

From a UI/UX + HCI review of the live site with the IEP:

**Targets.** Boxes were ~15px tall with ~14px between neighbours
(Eligibility checkboxes ~2px apart) and 10px corner handles, so
dragging grabbed the wrong field. Now: a Zoom toolbar above every
preview (Fit, 100–300%, re-renders sharper when zoomed, scrolls
when wider than the column); each box has an invisible 4pt grab
area past its visible edge; corner handles are 12px; and arrow
keys nudge the selected box 1pt (Shift: 10pt) — Up is +y for every
field type, so it moves up the page.

**Check answers.** Nothing is Required by default, so the check
passed with 134 of 136 fields empty and unlocked Download. Now
"Check answers" counts every included field when none is marked
Required (when some are Required, only those count), so the check
is never vacuous. The result shows the real count ("134 fields
still empty" / "36 of 136 filled, 100 still empty but none
required"), and the Check / Download / Print / Clear bar is sticky
at the bottom of the Fill form, so the buttons and the feedback
are always visible instead of buried after 136 fields.

**Placeholder.** Every box used to be filled with lorem ipsum,
hiding the printed form underneath. Now only the selected or
hovered box shows its placeholder; a "Show placeholders" toggle
in the Setup toolbar turns them all on when the creator wants to
check fonts. Detection unchanged (136 fields).

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
