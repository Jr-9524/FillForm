import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { DetectedField } from './fields'

const BASE_FONT_SIZE = 12
const MIN_FONT_SIZE = 7

/**
 * Slice 5: draw the filled answers onto the ORIGINAL PDF, at the
 * stored blank positions (PDF points, origin bottom-left — the same
 * system detection uses, so the overlay lands on the blanks).
 *
 * The original layout, fonts and logos are untouched; answers are
 * only drawn on top. Long answers shrink to fit the blank width,
 * down to 7pt, instead of overlapping the next label.
 */
export async function generateFilledPdf(
  originalBytes: ArrayBuffer,
  fields: DetectedField[],
  answers: Record<string, string>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const pages = doc.getPages()

  for (const field of fields) {
    if (!field.included) continue
    const text = (answers[field.id] ?? '').trim()
    if (!text) continue
    const page = pages[field.page - 1]
    if (!page) continue

    // Checkbox: a checked box gets an X inside the box. Detection
    // stores the box's bottom edge in field.y.
    if (field.type === 'checkbox') {
      if (['true', 'checked', 'yes', 'x'].includes(text.toLowerCase())) {
        page.drawText('X', {
          x: field.x + 2,
          y: field.y + 3,
          size: 10,
          font,
          color: rgb(0, 0, 0),
        })
      }
      continue
    }

    // Shrink the font so a long answer fits the blank instead of
    // running over the next label.
    let size = BASE_FONT_SIZE
    while (
      size > MIN_FONT_SIZE &&
      font.widthOfTextAtSize(text, size) > field.width
    ) {
      size -= 0.5
    }

    page.drawText(text, {
      // +4pt gap after the label, so the answer does not stick to
      // the colon ("Student Name:awd" -> "Student Name: awd").
      x: field.x + 4,
      // Detection y is the text baseline of the line the blank sits
      // on, so draw on that same baseline.
      y: field.y,
      size,
      font,
      color: rgb(0, 0, 0),
      maxWidth: field.width,
    })
  }

  return doc.save()
}
