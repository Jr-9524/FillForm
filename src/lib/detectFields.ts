import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
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
const CHECKBOX_CHARS = new Set(["☐", "□", "\u2B1C", "☑", "☒"]);

// pdf.js operator codes (OPS) and path codes (DrawOPS).
const OP_SAVE = 10;
const OP_RESTORE = 11;
const OP_TRANSFORM = 12;
const OP_CONSTRUCT_PATH = 91;
const PAINT_STROKE = 20;
const PAINT_FILL = 22;

type VecLine = { x1: number; y1: number; x2: number; y2: number };
type VecSquare = { x: number; y: number; size: number };
/** A drawn rectangle: y1 is the bottom edge, y2 the top edge. */
type VecRect = { x1: number; y1: number; x2: number; y2: number };
type Matrix = [number, number, number, number, number, number];

/** Matrix multiply: apply b, then a. */
function mulMatrix(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/**
 * Read the page's drawn vector shapes: the blanks in a form are
 * usually drawn lines (stroked paths), not text — so the line itself
 * is the ground truth for where a blank is and how long it is.
 * Returns horizontal stroked lines (25–200pt), small filled squares
 * (9–17pt, i.e. drawn checkboxes) and drawn rectangles (writing
 * boxes, 60pt+ wide, 25–200pt tall — section containers excluded).
 * `constructPath` args are [paintOp, [interleaved DrawOPS path],
 * bbox]; path ops are moveTo 0 / lineTo 1 / curveTo 2 /
 * quadraticCurveTo 3 / closePath 4.
 */
async function extractVector(
  page: PDFPageProxy,
): Promise<{ lines: VecLine[]; squares: VecSquare[]; rects: VecRect[] }> {
  const lines: VecLine[] = [];
  const squares: VecSquare[] = [];
  const rects: VecRect[] = [];
  let opList: Awaited<ReturnType<typeof page.getOperatorList>>;
  try {
    opList = await page.getOperatorList();
  } catch {
    return { lines, squares, rects };
  }

  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const fillSegs: VecLine[] = [];
  const strokeSegs: VecLine[] = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i] as unknown[];
    if (fn === OP_SAVE) {
      stack.push(ctm);
    } else if (fn === OP_RESTORE) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    } else if (fn === OP_TRANSFORM) {
      ctm = mulMatrix(ctm, args as unknown as Matrix);
    } else if (fn === OP_CONSTRUCT_PATH) {
      const paintOp = args[0] as number;
      const data = (args[1] as unknown[][])?.[0] as number[] | undefined;
      if (!data) continue;
      let cx = 0;
      let cy = 0;
      let sx = 0;
      let sy = 0;
      let j = 0;
      const segs: VecLine[] = [];
      while (j < data.length) {
        const op = data[j++];
        if (op === 0) {
          cx = data[j++];
          cy = data[j++];
          sx = cx;
          sy = cy;
        } else if (op === 1) {
          const x = data[j++];
          const y = data[j++];
          segs.push({ x1: cx, y1: cy, x2: x, y2: y });
          cx = x;
          cy = y;
        } else if (op === 2) {
          j += 6;
          cx = data[j - 2];
          cy = data[j - 1];
        } else if (op === 3) {
          j += 4;
          cx = data[j - 2];
          cy = data[j - 1];
        } else if (op === 4) {
          segs.push({ x1: cx, y1: cy, x2: sx, y2: sy });
          cx = sx;
          cy = sy;
        } else {
          break;
        }
      }
      for (const s of segs) {
        const x1 = ctm[0] * s.x1 + ctm[2] * s.y1 + ctm[4];
        const y1 = ctm[1] * s.x1 + ctm[3] * s.y1 + ctm[5];
        const x2 = ctm[0] * s.x2 + ctm[2] * s.y2 + ctm[4];
        const y2 = ctm[1] * s.x2 + ctm[3] * s.y2 + ctm[5];
        if (paintOp === PAINT_STROKE) {
          strokeSegs.push({ x1, y1, x2, y2 });
        } else if (paintOp === PAINT_FILL) {
          fillSegs.push({ x1, y1, x2, y2 });
        }
      }
    }
  }

  // Horizontal stroked lines (25–200pt): the single-line blanks.
  for (const s of strokeSegs) {
    if (Math.abs(s.y2 - s.y1) > 0.6) continue;
    const len = Math.abs(s.x2 - s.x1);
    if (len < 25 || len > 200) continue;
    const line: VecLine = {
      x1: Math.min(s.x1, s.x2),
      y1: (s.y1 + s.y2) / 2,
      x2: Math.max(s.x1, s.x2),
      y2: (s.y1 + s.y2) / 2,
    };
    if (
      !lines.some(
        (l) =>
          Math.abs(l.y1 - line.y1) < 1 &&
          Math.abs(l.x1 - line.x1) < 2 &&
          Math.abs(l.x2 - line.x2) < 2,
      )
    ) {
      lines.push(line);
    }
  }

  // Drawn rectangles (writing boxes): a top edge, the nearest
  // matching bottom edge below it, and side verticals spanning them.
  const dedupeSegs = (segs: VecLine[]): VecLine[] => {
    const out: VecLine[] = [];
    for (const s of segs) {
      if (
        !out.some(
          (o) =>
            Math.abs(o.x1 - s.x1) < 1 &&
            Math.abs(o.y1 - s.y1) < 1 &&
            Math.abs(o.x2 - s.x2) < 1 &&
            Math.abs(o.y2 - s.y2) < 1,
        )
      ) {
        out.push(s);
      }
    }
    return out;
  };
  const hSegs = dedupeSegs(
    strokeSegs.filter(
      (s) => Math.abs(s.y2 - s.y1) < 0.6 && Math.abs(s.x2 - s.x1) >= 40,
    ),
  );
  const vSegs = dedupeSegs(
    strokeSegs.filter(
      (s) => Math.abs(s.x2 - s.x1) < 0.6 && Math.abs(s.y2 - s.y1) >= 20,
    ),
  );
  for (const h of hSegs) {
    const x1 = Math.min(h.x1, h.x2);
    const x2 = Math.max(h.x1, h.x2);
    const yT = (h.y1 + h.y2) / 2;
    let bestY: number | null = null;
    for (const o of hSegs) {
      const oy = (o.y1 + o.y2) / 2;
      if (oy > yT - 15) continue;
      if (
        Math.abs(Math.min(o.x1, o.x2) - x1) > 3 ||
        Math.abs(Math.max(o.x1, o.x2) - x2) > 3
      ) {
        continue;
      }
      if (bestY === null || oy > bestY) bestY = oy;
    }
    if (bestY === null) continue;
    const yB = bestY;
    const spans = (x: number) =>
      vSegs.some(
        (v) =>
          Math.abs(v.x1 - x) < 3 &&
          Math.min(v.y1, v.y2) <= yB + 2 &&
          Math.max(v.y1, v.y2) >= yT - 2,
      );
    if (!spans(x1) || !spans(x2)) continue;
    const w = x2 - x1;
    const hh = yT - yB;
    // Writing boxes can be short (the Present Levels boxes are
    // 23–24pt tall); the 18pt floor keeps stroked checkbox outlines
    // (~14pt) out.
    if (w < 60 || hh < 18 || hh > 200) continue;
    const rect: VecRect = { x1, y1: yB, x2, y2: yT };
    if (
      !rects.some(
        (r) =>
          Math.abs(r.x1 - x1) < 2 &&
          Math.abs(r.x2 - x2) < 2 &&
          Math.abs(r.y1 - yB) < 2 &&
          Math.abs(r.y2 - yT) < 2,
      )
    ) {
      rects.push(rect);
    }
  }
  // Drop containers: a rect that fully contains another rect is a
  // section frame, not a writing box.
  const boxRects = rects.filter(
    (r) =>
      !rects.some(
        (o) =>
          o !== r &&
          o.x1 >= r.x1 + 4 &&
          o.y1 >= r.y1 + 4 &&
          o.x2 <= r.x2 - 4 &&
          o.y2 <= r.y2 - 4,
      ),
  );
  rects.length = 0;
  rects.push(...boxRects);

  // Drawn checkboxes: small filled rectangles, 9–17pt a side.
  // Group the small fill segments whose bounding boxes overlap.
  const small = fillSegs.filter((s) => {
    const dx = Math.abs(s.x2 - s.x1);
    const dy = Math.abs(s.y2 - s.y1);
    return (
      (dx >= 6 && dx <= 20 && dy < 0.6) || (dy >= 6 && dy <= 20 && dx < 0.6)
    );
  });
  const groups: VecLine[][] = [];
  for (const s of small) {
    const g = groups.find((group) =>
      group.some(
        (o) =>
          Math.min(s.x1, s.x2) <= Math.max(o.x1, o.x2) + 2 &&
          Math.max(s.x1, s.x2) >= Math.min(o.x1, o.x2) - 2 &&
          Math.min(s.y1, s.y2) <= Math.max(o.y1, o.y2) + 2 &&
          Math.max(s.y1, s.y2) >= Math.min(o.y1, o.y2) - 2,
      ),
    );
    if (g) g.push(s);
    else groups.push([s]);
  }
  for (const g of groups) {
    if (g.length < 3) continue;
    const xs = g.flatMap((s) => [s.x1, s.x2]);
    const ys = g.flatMap((s) => [s.y1, s.y2]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(...xs) - x;
    const h = Math.max(...ys) - y;
    if (w >= 9 && w <= 17 && h >= 9 && h <= 17) {
      if (!squares.some((q) => Math.abs(q.x - x) < 2 && Math.abs(q.y - y) < 2)) {
        squares.push({ x, y, size: (w + h) / 2 });
      }
    }
  }

  return { lines, squares, rects };
}

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
 * 2. A label ending in `:` (e.g. "Name:") with a blank after it. The
 *    blank is the DRAWN line on the page: same-row line first (exact
 *    position and length), then the line below the label (many forms
 *    put the blank under the label), then the old gap/column fallback
 *    for forms with no drawn lines.
 * 3. Checkboxes: a `☐` / `□` text item, or a drawn square, with its
 *    label to the right. Type is "checkbox"; the fill form shows a
 *    tick box and the filled PDF gets an X in the box.
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
    // Drawn lines/squares/rects on this page — the real blanks.
    const {
      lines: vectorLines,
      squares,
      rects: vectorRects,
    } = await extractVector(page);
    const unusedLines = [...vectorLines];

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
    // "Label:" items, collected across the page for the Rule 2 passes.
    const pageColonLabels: {
      item: LineItem;
      label: string;
      line: LineItem[];
      index: number;
    }[] = [];
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

    // A text item's full line, including same-line fragments split
    // off it ("for writi" + "ng" = "for writing"). Only joins a
    // fragment that starts within 2pt of the previous item's end —
    // a real word split, not the next column's text.
    function fullLineText(item: LineItem): string {
      let text = item.str.trim();
      let current = item;
      for (let depth = 0; depth < 2; depth++) {
        const next = items
          .filter(
            (it) =>
              Math.abs(it.y - current.y) <= LINE_TOLERANCE &&
              it.x >= current.x + current.width - 2 &&
              it.x - (current.x + current.width) <= 2 &&
              it.str.trim().length > 0 &&
              !it.str.trim().endsWith(":") &&
              !isHeading(it.str),
          )
          .sort((a, b) => a.x - b.x)[0];
        if (!next) break;
        const gap = next.x - (current.x + current.width);
        text += (gap < 2 ? "" : " ") + next.str.trim();
        current = next;
      }
      return text;
    }

    // The first line(s) of a wrapped label, above this item, e.g.
    // "Date of Initial Meeting" above "to Determine Eligibility:".
    // Used to complete the label when a drawn line proves the field
    // is real (otherwise isContinuation skips it).
    function wrappedPrefix(labelItem: LineItem): string {
      const parts: string[] = [];
      let current = labelItem;
      for (let depth = 0; depth < 2; depth++) {
        const above = items.find(
          (item) =>
            item.y > current.y + 10 &&
            item.y < current.y + 14 &&
            Math.abs(item.x - current.x) < 25 &&
            item.str.trim().length > 0 &&
            !item.str.trim().endsWith(":") &&
            !isHeading(item.str),
        );
        if (!above) break;
        parts.unshift(fullLineText(above));
        current = above;
      }
      return parts.join(" ");
    }

    // The continuation line(s) of a wrapped option label, below this
    // item, e.g. "repeated directions" below "Simplified &".
    function wrappedSuffix(labelItem: LineItem): string {
      const parts: string[] = [];
      let current = labelItem;
      for (let depth = 0; depth < 2; depth++) {
        const below = items.find(
          (item) =>
            item.y < current.y - 10 &&
            item.y > current.y - 15 &&
            Math.abs(item.x - current.x) < 25 &&
            item.str.trim().length > 0 &&
            !item.str.trim().endsWith(":") &&
            !isHeading(item.str),
        );
        if (!below) break;
        parts.push(fullLineText(below));
        current = below;
      }
      return parts.join(" ");
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
        const suffix = wrappedSuffix(next);
        const fullLabel = suffix ? `${label} ${suffix}` : label;
        found.push({
          id: `p${pageNumber}-b${found.length}`,
          page: pageNumber,
          x: round(item.x),
          // The ☐ glyph spans roughly item.y - 12 to item.y + 3 in
          // files like this IEP (text origin sits near the glyph's
          // top), so the box is shifted down to cover the glyph.
          y: round(item.y - 12),
          width: 12,
          height: 15,
          label: fullLabel,
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

      // Rule 2 collects the colon labels on this line; the actual
      // matching runs after the line loop, in passes over the whole
      // page (same-row first, then below-label), so a label cannot
      // steal the line that belongs to the label below it.
      // Skip lines that already had an underscore field — the label
      // there belongs to it.
      if (lineHasUnderscore) continue;
      for (let i = 0; i < line.length; i++) {
        const item = line[i];
        const trimmed = item.str.trim();
        if (!trimmed.endsWith(":")) continue;
        const label = cleanLabel(trimmed.slice(0, -1));
        if (!label || isFragmentLabel(label)) continue;
        if (label.toLowerCase().includes("check all that apply")) continue;
        pageColonLabels.push({ item, label, line, index: i });
      }
    }

    const pushTextField = (
      item: LineItem,
      label: string,
      fieldX: number,
      fieldY: number,
      fieldWidth: number,
    ) => {
      const prefix = wrappedPrefix(item);
      const fullLabel = prefix ? `${prefix} ${label}` : label;
      found.push({
        id: `p${pageNumber}-c${found.length}`,
        page: pageNumber,
        x: round(fieldX),
        y: round(fieldY),
        width: round(fieldWidth),
        height: round(item.height || 12),
        label: fullLabel,
        type: "text",
        order: 0,
        included: true,
        required: false,
        group: group(fieldX, fieldY),
      });
    };

    const claimed = new Set<number>();

    // Pass 1 — drawn line on the same row as the label. This is the
    // real blank: exact position and length. A line here overrides
    // the header/continuation skips (e.g. "Date of Initial Meeting
    // to Determine Eligibility:" really does have a blank to its right).
    for (let k = 0; k < pageColonLabels.length; k++) {
      const { item, label } = pageColonLabels[k];
      const fieldX = item.x + item.width;
      const rowLine = unusedLines.find(
        (l) =>
          Math.abs(l.y1 - item.y) <= 4 &&
          l.x1 >= fieldX - 8 &&
          l.x1 - fieldX <= 60 &&
          l.x2 - l.x1 >= 25,
      );
      if (!rowLine) continue;
      unusedLines.splice(unusedLines.indexOf(rowLine), 1);
      claimed.add(k);
      pushTextField(item, label, rowLine.x1, rowLine.y1, rowLine.x2 - rowLine.x1);
    }

    // Pass 2 — drawn line below the label. Many forms put the blank
    // on the line under the label ("School of Attendance:", "School
    // Address:", "Contact Number:") — the old to-the-right field
    // floated in empty space instead.
    for (let k = 0; k < pageColonLabels.length; k++) {
      if (claimed.has(k)) continue;
      const { item, label, line } = pageColonLabels[k];
      // A checkbox option ("☐ Therapy Services:") has no blank of
      // its own — its line, if any, would be on its row (pass 1).
      if (
        line.some(
          (candidate) =>
            candidate.x < item.x &&
            CHECKBOX_CHARS.has(candidate.str.trim()),
        )
      ) {
        continue;
      }
      const belowLine = unusedLines.find(
        (l) =>
          l.y1 < item.y - 6 &&
          l.y1 >= item.y - 24 &&
          Math.abs(l.x1 - item.x) <= 30 &&
          l.x2 - l.x1 >= 30,
      );
      if (!belowLine) continue;
      unusedLines.splice(unusedLines.indexOf(belowLine), 1);
      claimed.add(k);
      pushTextField(
        item,
        label,
        belowLine.x1,
        belowLine.y1,
        belowLine.x2 - belowLine.x1,
      );
    }

    // Textarea pass — big empty boxes (writing areas) with a label
    // at the top or just above them. The label can end with ":" or
    // not ("Student's Strengths, Preferences & Interests" has none).
    // Runs after the line passes, so a label that already has a blank
    // (line field, checkbox) is excluded; claimed labels skip pass 3.
    // A box is claimed by its lowest label that has no blank yet, and
    // the textarea runs from just below that label to the next label
    // below it (or the box bottom), so it never covers other labels.
    {
      const isOptionLabel = (labelItem: LineItem): boolean => {
        const lineOf = lines.find((l) => l.includes(labelItem));
        if (
          lineOf?.some(
            (c) => c.x < labelItem.x && CHECKBOX_CHARS.has(c.str.trim()),
          )
        ) {
          return true;
        }
        return squares.some(
          (sq) =>
            Math.abs(sq.y + sq.size / 2 - labelItem.y) <= 7 &&
            labelItem.x - (sq.x + sq.size) >= -2 &&
            labelItem.x - (sq.x + sq.size) <= 40,
        );
      };
      // A wrapped label's continuation line above this item (same
      // window as wrappedPrefix) — such an item is part of the label
      // above it, not a box label of its own.
      const hasLineAbove = (labelItem: LineItem): boolean =>
        items.some(
          (it) =>
            it.y > labelItem.y + 10 &&
            it.y < labelItem.y + 14 &&
            Math.abs(it.x - labelItem.x) < 25 &&
            it.str.trim().length > 0 &&
            !it.str.trim().endsWith(":") &&
            !isHeading(it.str),
        );

      type CandLabel = { item: LineItem; label: string; colonIndex: number };
      const candLabels: CandLabel[] = pageColonLabels.map((c, i) => ({
        item: c.item,
        label: c.label,
        colonIndex: i,
      }));
      for (const item of items) {
        const text = item.str.trim();
        if (text.length < 3 || text.includes(":")) continue;
        if (isHeading(item.str)) continue;
        if (isFragmentLabel(cleanLabel(text))) continue;
        if (hasLineAbove(item)) continue;
        if (candLabels.some((c) => c.item === item)) continue;
        candLabels.push({
          item,
          label: cleanLabel(text),
          colonIndex: -1,
        });
      }

      const unusedRects = [...vectorRects].sort(
        (a, b) => (a.x2 - a.x1) * (a.y2 - a.y1) - (b.x2 - b.x1) * (b.y2 - b.y1),
      );
      for (const rect of unusedRects) {
        const associated = candLabels
          .filter(
            (c) =>
              (c.colonIndex < 0 || !claimed.has(c.colonIndex)) &&
              !isOptionLabel(c.item) &&
              c.item.x >= rect.x1 - 15 &&
              c.item.x <= rect.x1 + 150 &&
              c.item.y >= rect.y1 &&
              c.item.y <= rect.y2 + 12,
          )
          .sort((a, b) => a.item.y - b.item.y); // lowest label first
        for (const cand of associated) {
          const labelItem = cand.item;
          // Lowest wrapped line of this label (a 2-line label's
          // second line sits ~13pt below the first).
          let labelBottomY = labelItem.y;
          for (const it of items) {
            if (
              it.y < labelItem.y - 10 &&
              it.y > labelItem.y - 15 &&
              Math.abs(it.x - labelItem.x) < 25 &&
              it.str.trim().length > 0 &&
              !it.str.trim().endsWith(":")
            ) {
              labelBottomY = Math.min(labelBottomY, it.y);
            }
          }
          const top = Math.min(labelBottomY - 4, rect.y2 - 2);
          // Next label below inside this box caps the textarea.
          let bottom = rect.y1 + 4;
          for (const it of items) {
            if (
              it.str.trim().length > 0 &&
              !isHeading(it.str) &&
              it.x >= rect.x1 - 5 &&
              it.x <= rect.x2 + 5 &&
              it.y < labelItem.y - 6 &&
              it.y >= rect.y1
            ) {
              bottom = Math.max(bottom, it.y + 8);
            }
          }
          const height = top - bottom;
          if (height < 14) continue;
          const suffix =
            cand.colonIndex < 0 ? wrappedSuffix(labelItem) : "";
          const fullLabel =
            cand.colonIndex >= 0
              ? (() => {
                  const prefix = wrappedPrefix(labelItem);
                  return prefix ? `${prefix} ${cand.label}` : cand.label;
                })()
              : suffix
                ? `${cand.label} ${suffix}`
                : cand.label;
          found.push({
            id: `p${pageNumber}-t${found.length}`,
            page: pageNumber,
            x: round(rect.x1 + 4),
            // y is the TOP of the textarea (sorting + overlay +
            // print all read it that way for textareas).
            y: round(top),
            width: round(rect.x2 - rect.x1 - 8),
            height: round(height),
            label: fullLabel,
            type: "textarea",
            order: 0,
            included: true,
            required: false,
            group: group(rect.x1 + 4, top),
          });
          if (cand.colonIndex >= 0) claimed.add(cand.colonIndex);
          // The box's edges are not blanks — keep pass 2 from
          // claiming them as below-label lines.
          for (let n = unusedLines.length - 1; n >= 0; n--) {
            const l = unusedLines[n];
            const isEdge =
              (Math.abs(l.y1 - rect.y2) < 1 ||
                Math.abs(l.y1 - rect.y1) < 1) &&
              l.x1 >= rect.x1 - 3 &&
              l.x2 <= rect.x2 + 3;
            if (isEdge) unusedLines.splice(n, 1);
          }
          break;
        }
      }
    }

    // Pass 3 — fallback for forms with no drawn lines: the old
    // gap/column logic, with the header and continuation skips.
    for (let k = 0; k < pageColonLabels.length; k++) {
      if (claimed.has(k)) continue;
      const { item, label, line, index: i } = pageColonLabels[k];
      // Same as pass 2: a checkbox option with no drawn line is an
      // option, not a blank ("☐ Therapy Services:" has no line after it).
      if (
        line.some(
          (candidate) =>
            candidate.x < item.x &&
            CHECKBOX_CHARS.has(candidate.str.trim()),
        )
      ) {
        continue;
      }
      if (hasCheckboxBelow(item)) continue;
      if (hasOptionBelow(item)) continue;
      if (isContinuation(item)) continue;
      // A long sentence is not a label ("The following individuals
      // participated in the development of this IEP:"). Line-backed
      // labels never reach this fallback, so only the guess is cut.
      if (label.split(/\s+/).length > 8) continue;

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

      pushTextField(item, label, fieldX, item.y, fieldWidth);
    }

    // Rule 3b: drawn checkboxes (filled squares). The label is the
    // text just to the right on the same row — this catches the
    // Meeting checkboxes, which are vector squares, not text.
    for (const sq of squares) {
      const cy = sq.y + sq.size / 2;
      const next = items
        .filter(
          (it) =>
            it.str.trim().length > 0 &&
            it.x >= sq.x + sq.size - 2 &&
            it.x - (sq.x + sq.size) <= 40 &&
            Math.abs(it.y - cy) <= 7,
        )
        .sort((a, b) => a.x - b.x)[0];
      if (!next) continue;
      const label = cleanLabel(next.str);
      if (!label || isFragmentLabel(label)) continue;
      if (next.str.trim().endsWith(":")) continue;
      if (isHeading(next.str)) continue;
      if (
        found.some(
          (f) =>
            f.type === "checkbox" &&
            Math.abs(f.x - sq.x) < 5 &&
            Math.abs(f.y - sq.y) < 8,
        )
      ) {
        continue;
      }
      const suffix = wrappedSuffix(next);
      const fullLabel = suffix ? `${label} ${suffix}` : label;
      found.push({
        id: `p${pageNumber}-s${found.length}`,
        page: pageNumber,
        x: round(sq.x),
        y: round(sq.y),
        width: round(sq.size),
        height: round(sq.size),
        label: fullLabel,
        type: "checkbox",
        order: 0,
        included: true,
        required: false,
        group: group(sq.x, cy),
      });
    }
  }

  return sortAndOrderFields(found);
}
