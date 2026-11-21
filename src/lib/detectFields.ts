import type { PDFDocumentProxy } from "pdfjs-dist";
import { sortAndOrderFields } from "./fields";
import type { DetectedField } from "./fields";

// pdfjs-dist does not export TextItem from its root, so use a minimal
// structural type matching the TextItem shape we actually read.
type PdfTextItem = {
  str: string;
  transform: unknown[];
  width: number;
  height: number;
};

type LineItem = {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type Heading = {
  text: string;
  x: number;
  y: number;
  width: number;
};

const UNDERSCORE_RUN = /_{3,}/g;
const LINE_TOLERANCE = 4; // points: items this close in y count as one line
const MIN_GAP_AFTER_LABEL = 20; // points of empty space after "Label:" = a blank
const CHECKBOX_CHARS = new Set(["☐", "□", "☑", "☒"]);

function isTextItem(item: unknown): item is PdfTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    typeof (item as PdfTextItem).str === "string" &&
    "transform" in item &&
    Array.isArray((item as PdfTextItem).transform)
  );
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function cleanLabel(text: string): string {
  return text
    .trim()
    .replace(/[:\s]+$/, "")
    .trim();
}

const MAX_FIELD_WIDTH = 200; // points: never let a detected field span a whole table
const MAX_GAP_AFTER_LABEL = 250; // points: a bigger gap is a different column / cell, not a blank

/** True for fragment labels split off a longer label, e.g. "apply)" from "(Check all that apply):". */
function isFragmentLabel(label: string): boolean {
  if (label.length < 3) return true;
  if (!/^[A-Za-z]/.test(label)) return true;
  if (label.startsWith(")")) return true;
  // Single word ending in ")" with no opening "(" — a leftover fragment.
  if (!label.includes(" ") && label.endsWith(")")) return true;
  // Unbalanced parentheses — also a split fragment.
  const opens = (label.match(/\(/g) ?? []).length;
  const closes = (label.match(/\)/g) ?? []).length;
  if (opens !== closes) return true;
  if (label.startsWith("(") && opens !== closes) return true;
  return false;
}

/**
 * Section headings are ALL-CAPS text with no colon, e.g.
 * "STUDENT INFORMATION", "ELIGIBILITY", "PARENT INFORMATION".
 * They group the fields below them (used for the grouped field list).
 */
function isHeading(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 4) return false;
  if (trimmed.endsWith(":")) return false;
  if (/[a-z]/.test(trimmed)) return false;
  if (!/[A-Z]/.test(trimmed)) return false;
  return true;
}

/**
 * Columns are defined by the top header row: headings are centred in
 * their column, so a column's boundaries are the midpoints between
 * neighbouring heading centres (e.g. STUDENT / ELIGIBILITY / MEETING
 * on the IEP). A field belongs to the column its x falls in, and to
 * the nearest heading above it *in that column* — a heading further
 * down the page in another column (e.g. "PARENT INFORMATION" under
 * "STUDENT INFORMATION") does not claim a middle-column field.
 */
function columnIndex(headings: Heading[], x: number): number {
  if (headings.length === 0) return 0;
  const topY = Math.max(...headings.map((h) => h.y));
  const top = headings
    .filter((h) => Math.abs(h.y - topY) <= 30)
    .map((h) => h.x + h.width / 2)
    .sort((a, b) => a - b);
  let index = 0;
  for (let i = 0; i < top.length - 1; i++) {
    if (x > (top[i] + top[i + 1]) / 2) index = i + 1;
  }
  return index;
}

function columnBounds(
  headings: Heading[],
  x: number,
  pageWidth: number,
): { start: number; end: number } {
  if (headings.length === 0) return { start: 0, end: pageWidth - 20 };
  const topY = Math.max(...headings.map((h) => h.y));
  const top = headings
    .filter((h) => Math.abs(h.y - topY) <= 30)
    .map((h) => h.x + h.width / 2)
    .sort((a, b) => a - b);
  const index = columnIndex(headings, x);
  const start = index === 0 ? 0 : (top[index - 1] + top[index]) / 2;
  const end =
    index >= top.length - 1
      ? pageWidth - 20
      : (top[index] + top[index + 1]) / 2;
  return { start, end };
}

/** The section heading above a field, in the same column. Null if none. */
function headingFor(
  headings: Heading[],
  x: number,
  y: number,
): Heading | null {
  if (headings.length === 0) return null;
  const index = columnIndex(headings, x);
  const topY = Math.max(...headings.map((h) => h.y));
  const top = headings
    .filter((h) => Math.abs(h.y - topY) <= 30)
    .map((h) => h.x + h.width / 2)
    .sort((a, b) => a - b);
  const colStart = index === 0 ? -Infinity : (top[index - 1] + top[index]) / 2;
  const colEnd =
    index >= top.length - 1 ? Infinity : (top[index] + top[index + 1]) / 2;
  let best: Heading | null = null;
  for (const heading of headings) {
    if (heading.y <= y) continue;
    const centre = heading.x + heading.width / 2;
    if (centre < colStart || centre > colEnd) continue;
    if (!best || heading.y < best.y) best = heading;
  }
  return best;
}

/**
 * Right edge of the column a field sits in. Blanks run to this edge,
 * not across to the next column — that is what dropped "Sex" and
 * "Contact Number" on the IEP, where the next text on the line was
 * in another column 400pt away.
 */
function columnEndFor(
  headings: Heading[],
  x: number,
  _y: number,
  pageWidth: number,
): number {
  return columnBounds(headings, x, pageWidth).end;
}

/**
 * Detect blanks in a PDF with simple rules — no ML.
 *
 * 1. Underscore runs (`____`): a field at the underscores. The label is
 *    the text before the underscores on the same item, or the item to
 *    its left on the same line, or "Field".
 * 2. A label ending in `:` (e.g. "Name:") with empty space after it on
 *    the same line: a field in that empty space, to the right of the label.
 *    If the next text is in another column, the blank runs to the end
 *    of this column instead of being skipped.
 * 3. Checkboxes: a `☐` / `□` text item, with its label to the right.
 *    Type is "checkbox"; the fill form shows a tick box and the filled
 *    PDF gets an X in the box.
 * 4. Group headers (e.g. "Support Areas (Check all that apply):",
 *    "Purpose of Meeting:") are skipped: their options are the
 *    checkboxes below them, not a blank to the right.
 *
 * Fields carry the section heading above them in `group`, and are
 * returned in document order: page, top-to-bottom, left-to-right.
 */
export async function detectFields(
  pdf: PDFDocumentProxy,
): Promise<DetectedField[]> {
  const found: DetectedField[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth = viewport.width;
    const textContent = await page.getTextContent();

    const items: LineItem[] = (textContent.items as unknown[])
      .filter(isTextItem)
      .filter((item) => item.str.length > 0)
      .map((item) => ({
        str: item.str,
        // transform is [a, b, c, d, x, y] in PDF points, origin bottom-left.
        x: Number(item.transform[4] ?? 0),
        y: Number(item.transform[5] ?? 0),
        width: item.width,
        height: item.height,
      }));

    const headings: Heading[] = items
      .filter((item) => isHeading(item.str))
      .map((item) => ({
        text: item.str.trim(),
        x: item.x,
        y: item.y,
        width: item.width,
      }));

    const columnEnd = (x: number, y: number) =>
      columnEndFor(headings, x, y, pageWidth);
    const group = (x: number, y: number) =>
      headingFor(headings, x, y)?.text ?? "";

    // Group items into lines: same y (within tolerance) = same line.
    // Lines are top-to-bottom (PDF y grows upwards, so higher y first).
    const lines: LineItem[][] = [];
    for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const line = lines.find(
        (candidate) => Math.abs(candidate[0].y - item.y) <= LINE_TOLERANCE,
      );
      if (line) {
        line.push(item);
      } else {
        lines.push([item]);
      }
    }

    // Is there a checkbox on the line just below this label? If so the
    // label is a group header ("Support Areas...", "Purpose of Meeting:"),
    // not a field with a blank to its right.
    function hasCheckboxBelow(labelItem: LineItem): boolean {
      return items.some(
        (item) =>
          CHECKBOX_CHARS.has(item.str.trim()) &&
          item.y < labelItem.y - 10 &&
          item.y > labelItem.y - 28 &&
          // The checkbox list starts at (nearly) the label's x —
          // a checkbox in the next column does not make this a header.
          item.x >= labelItem.x - 5 &&
          item.x <= labelItem.x + 40,
      );
    }

    // A plain option word just below the label ("Initial" under
    // "Purpose of Meeting:") means the label is a header for the
    // options below it, not a field with a blank to its right.
    // (Meeting checkboxes are drawn shapes, not text, so the
    // checkbox check above cannot see them.)
    function hasOptionBelow(labelItem: LineItem): boolean {
      return items.some(
        (item) =>
          item.y < labelItem.y - 10 &&
          item.y > labelItem.y - 28 &&
          item.x >= labelItem.x &&
          item.x <= labelItem.x + 120 &&
          item.str.trim().length > 0 &&
          !item.str.trim().endsWith(":") &&
          !isHeading(item.str),
      );
    }

    // A ":" item whose line above is a plain label fragment
    // ("Date of Initial Meeting" above "to Determine Eligibility:")
    // is the second line of a wrapped label, not its own field.
    function isContinuation(labelItem: LineItem): boolean {
      return items.some(
        (item) =>
          // Wrapped-label lines sit ~11pt above the continuation;
          // checkbox options below a label sit ~16pt apart, so a
          // wider window would wrongly skip "Therapy Services:".
          item.y > labelItem.y + 10 &&
          item.y < labelItem.y + 14 &&
          Math.abs(item.x - labelItem.x) < 20 &&
          item.str.trim().length > 0 &&
          !item.str.trim().endsWith(":"),
      );
    }

    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      let lineHasUnderscore = false;

      // Rule 3: checkboxes. Runs before the label rules so a line like
      // "☐ Formal Diagnosis: ____" yields both a checkbox and a text field.
      for (let i = 0; i < line.length; i++) {
        const item = line[i];
        if (!CHECKBOX_CHARS.has(item.str.trim())) continue;
        const next = line
          .slice(i + 1)
          .find((candidate) => candidate.str.trim().length > 0);
        if (!next) continue;
        const label = cleanLabel(next.str);
        if (!label || isFragmentLabel(label)) continue;
        found.push({
          id: `p${pageNumber}-b${found.length}`,
          page: pageNumber,
          x: round(item.x),
          y: round(item.y),
          width: 12,
          height: 12,
          label,
          type: "checkbox",
          order: 0,
          included: true,
          required: false,
          group: group(item.x, item.y),
        });
      }

      // Rule 1: underscore runs.
      for (let i = 0; i < line.length; i++) {
        const item = line[i];
        UNDERSCORE_RUN.lastIndex = 0;
        let match: RegExpExecArray | null;
        let firstRun = true;
        while ((match = UNDERSCORE_RUN.exec(item.str)) !== null) {
          lineHasUnderscore = true;
          const runStart = match.index;
          const run = match[0];
          const charWidth =
            item.str.length > 0 ? item.width / item.str.length : 0;
          const fieldX = item.x + runStart * charWidth;
          const fieldWidth = Math.max(24, run.length * charWidth);

          let label = "";
          if (firstRun) {
            label = cleanLabel(item.str.slice(0, runStart));
            if (!label && i > 0) label = cleanLabel(line[i - 1].str);
          }
          if (!label) label = "Field";

          found.push({
            id: `p${pageNumber}-u${found.length}`,
            page: pageNumber,
            x: round(fieldX),
            y: round(item.y),
            width: round(fieldWidth),
            height: round(item.height || 12),
            label,
            type: "text",
            order: 0,
            included: true,
            required: false,
            group: group(fieldX, item.y),
          });
          firstRun = false;
        }
      }

      // Rule 2: "Label:" with empty space after it. Skip lines that
      // already had an underscore field — the label there belongs to it.
      if (lineHasUnderscore) continue;
      for (let i = 0; i < line.length; i++) {
        const item = line[i];
        const trimmed = item.str.trim();
        if (!trimmed.endsWith(":")) continue;
        const label = cleanLabel(trimmed.slice(0, -1));
        if (!label || isFragmentLabel(label)) continue;
        if (label.toLowerCase().includes("check all that apply")) continue;
        if (hasCheckboxBelow(item)) continue;
        if (hasOptionBelow(item)) continue;
        if (isContinuation(item)) continue;

        const fieldX = item.x + item.width;
        // Skip blank space items (e.g. the space between a ☐ and its label).
        const next = line
          .slice(i + 1)
          .find((candidate) => candidate.str.trim().length > 0);
        let fieldWidth: number;
        if (!next) {
          // Nothing after the label on this line: the blank runs to
          // the end of this column.
          fieldWidth = Math.min(
            MAX_FIELD_WIDTH,
            columnEnd(fieldX, item.y) - fieldX,
          );
          if (fieldWidth < 40) continue;
        } else {
          const gap = next.x - fieldX;
          if (gap < MIN_GAP_AFTER_LABEL) continue;
          if (gap > MAX_GAP_AFTER_LABEL) {
            // Next text is in another column: the blank runs to the
            // end of this column instead (e.g. "Sex:", "Contact Number:").
            fieldWidth = Math.min(
              MAX_FIELD_WIDTH,
              columnEnd(fieldX, item.y) - fieldX,
            );
            if (fieldWidth < 40) continue;
          } else {
            fieldWidth = Math.min(MAX_FIELD_WIDTH, gap);
          }
        }
        // Off the page — a wrapped label's second line, not a real blank.
        if (fieldX + fieldWidth > pageWidth - 10) continue;

        found.push({
          id: `p${pageNumber}-c${found.length}`,
          page: pageNumber,
          x: round(fieldX),
          y: round(item.y),
          width: round(fieldWidth),
          height: round(item.height || 12),
          label,
          type: "text",
          order: 0,
          included: true,
          required: false,
          group: group(fieldX, item.y),
        });
      }
    }
  }

  return sortAndOrderFields(found);
}
