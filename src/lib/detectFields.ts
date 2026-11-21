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

const UNDERSCORE_RUN = /_{3,}/g;
const LINE_TOLERANCE = 4; // points: items this close in y count as one line
const MIN_GAP_AFTER_LABEL = 20; // points of empty space after "Label:" = a blank

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
 * Detect blanks in a PDF with simple rules — no ML.
 *
 * 1. Underscore runs (`____`): a field at the underscores. The label is
 *    the text before the underscores on the same item, or the item to
 *    its left on the same line, or "Field".
 * 2. A label ending in `:` (e.g. "Name:") with empty space after it on
 *    the same line: a field in that empty space, to the right of the label.
 *
 * Fields are returned in document order: page, top-to-bottom, left-to-right.
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

    for (const line of lines) {
      line.sort((a, b) => a.x - b.x);
      let lineHasUnderscore = false;

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

        const fieldX = item.x + item.width;
        const next = line[i + 1];
        let fieldWidth: number;
        if (!next) {
          // Nothing after the label on this line: the blank runs to
          // near the right edge of the page.
          fieldWidth = Math.min(MAX_FIELD_WIDTH, pageWidth - fieldX - 36);
          if (fieldWidth < 40) continue;
        } else {
          const gap = next.x - fieldX;
          if (gap < MIN_GAP_AFTER_LABEL) continue;
          // A huge gap is a different column / table cell, not a blank.
          if (gap > MAX_GAP_AFTER_LABEL) continue;
          fieldWidth = Math.min(MAX_FIELD_WIDTH, gap);
        }

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
        });
      }
    }
  }

  return sortAndOrderFields(found);
}
