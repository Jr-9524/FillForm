/**
 * Live-preview fitting for answers drawn on a page.
 *
 * This mirrors generateFilledPdf's sizing (the field's font and
 * size, shrinking to 7pt, word-wrap for textareas) so the live text
 * on the Fill preview lands where the downloaded text will land.
 * The browser's font metrics stand in for pdf-lib's embedded font;
 * the numbers come out equal because both measure the same glyph
 * advances per em.
 */

import { cssFontString, getFieldFont, MIN_FONT_SIZE, type FieldFont } from "./fonts";

export const BASE_FONT_SIZE = 12;
export { MIN_FONT_SIZE };

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  if (!measureCtx) {
    const canvas = document.createElement("canvas");
    measureCtx = canvas.getContext("2d");
  }
  return measureCtx;
}

/** Width of the text in PDF points at the given size and font. */
export function measureTextWidth(
  text: string,
  sizePt: number,
  font: FieldFont = getFieldFont({}),
): number {
  const ctx = getMeasureCtx();
  if (!ctx) return text.length * sizePt * 0.55;
  ctx.font = cssFontString(font, sizePt);
  return ctx.measureText(text).width;
}

/** Largest size (field size down to 7, step 0.5) whose width fits maxWidthPt. */
export function fitSingleLineSize(
  text: string,
  maxWidthPt: number,
  font: FieldFont = getFieldFont({}),
): number {
  let size = font.size;
  while (
    size > MIN_FONT_SIZE &&
    measureTextWidth(text, size, font) > maxWidthPt
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
  font: FieldFont = getFieldFont({}),
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (measureTextWidth(test, sizePt, font) <= maxWidthPt) {
        line = test;
      } else {
        if (line) lines.push(line);
        let w = word;
        while (measureTextWidth(w, sizePt, font) > maxWidthPt && w.length > 1) {
          let cut = w.length - 1;
          while (
            cut > 0 &&
            measureTextWidth(w.slice(0, cut), sizePt, font) > maxWidthPt
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
  font: FieldFont = getFieldFont({}),
): { size: number; lines: string[] } {
  let size = font.size;
  let lines = wrapText(text, size, maxWidthPt, font);
  while (
    size > MIN_FONT_SIZE &&
    lines.length * size * 1.25 > maxHeightPt - 8
  ) {
    size -= 0.5;
    lines = wrapText(text, size, maxWidthPt, font);
  }
  return { size, lines };
}
