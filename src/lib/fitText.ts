/**
 * Live-preview fitting for answers drawn on a page.
 *
 * This mirrors generateFilledPdf's sizing (Helvetica, 12pt shrinking
 * to 7pt, word-wrap for textareas) so the live text on the Fill
 * preview lands where the downloaded text will land. The browser's
 * Helvetica metrics stand in for pdf-lib's embedded Helvetica; the
 * numbers come out equal because both measure the same glyph
 * advances per em.
 */

export const BASE_FONT_SIZE = 12;
export const MIN_FONT_SIZE = 7;

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!measureCtx) {
    const canvas = document.createElement("canvas");
    measureCtx = canvas.getContext("2d");
  }
  return measureCtx;
}

/** Width of the text in PDF points at the given size (Helvetica). */
export function measureTextWidth(text: string, sizePt: number): number {
  const ctx = getMeasureCtx();
  if (!ctx) return text.length * sizePt * 0.55;
  ctx.font = `${sizePt}px Helvetica, Arial, sans-serif`;
  return ctx.measureText(text).width;
}

/** Largest size (12 down to 7, step 0.5) whose width fits maxWidthPt. */
export function fitSingleLineSize(text: string, maxWidthPt: number): number {
  let size = BASE_FONT_SIZE;
  while (
    size > MIN_FONT_SIZE &&
    measureTextWidth(text, size) > maxWidthPt
  ) {
    size -= 0.5;
  }
  return size;
}

/** Word-wrap exactly like generateFilledPdf: hard-split over-wide words. */
export function wrapText(
  text: string,
  sizePt: number,
  maxWidthPt: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (measureTextWidth(test, sizePt) <= maxWidthPt) {
        line = test;
      } else {
        if (line) lines.push(line);
        let w = word;
        while (measureTextWidth(w, sizePt) > maxWidthPt && w.length > 1) {
          let cut = w.length - 1;
          while (
            cut > 0 &&
            measureTextWidth(w.slice(0, cut), sizePt) > maxWidthPt
          ) {
            cut--;
          }
          lines.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        line = w;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Wrapped lines and size for a textarea answer (mirrors the download). */
export function fitTextarea(
  text: string,
  maxWidthPt: number,
  maxHeightPt: number,
): { size: number; lines: string[] } {
  let size = BASE_FONT_SIZE;
  let lines = wrapText(text, size, maxWidthPt);
  while (
    size > MIN_FONT_SIZE &&
    lines.length * size * 1.25 > maxHeightPt - 8
  ) {
    size -= 0.5;
    lines = wrapText(text, size, maxWidthPt);
  }
  return { size, lines };
}
