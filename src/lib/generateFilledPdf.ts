import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib'
import type { DetectedField } from './fields'
import { getFieldFont, MIN_FONT_SIZE, type FieldFont } from './fonts'

/**
 * Slice 5: draw the filled answers onto the ORIGINAL PDF, at the
 * stored blank positions (PDF points, origin bottom-left — the same
 * system detection uses, so the overlay lands on the blanks).
 *
 * The original layout, fonts and logos are untouched; answers are
 * only drawn on top. Long answers shrink to fit the blank width,
 * down to 7pt, instead of overlapping the next label. Each field's
 * own font (family, size, bold, italic — set in the editor) is used
 * for its answer; pdf-lib's built-in StandardFonts need no files.
 */

/** Map a field's font choice to the matching built-in StandardFont. */
function standardFontFor(font: FieldFont): StandardFonts {
  if (font.family === 'times') {
    if (font.bold && font.italic) return StandardFonts.TimesRomanBoldItalic
    if (font.bold) return StandardFonts.TimesRomanBold
    if (font.italic) return StandardFonts.TimesRomanItalic
    return StandardFonts.TimesRoman
  }
  if (font.family === 'courier') {
    if (font.bold && font.italic) return StandardFonts.CourierBoldOblique
    if (font.bold) return StandardFonts.CourierBold
    if (font.italic) return StandardFonts.CourierOblique
    return StandardFonts.Courier
  }
  if (font.bold && font.italic) return StandardFonts.HelveticaBoldOblique
  if (font.bold) return StandardFonts.HelveticaBold
  if (font.italic) return StandardFonts.HelveticaOblique
  return StandardFonts.Helvetica
}

export async function generateFilledPdf(
  originalBytes: ArrayBuffer,
  fields: DetectedField[],
  answers: Record<string, string>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(originalBytes)
  const pages = doc.getPages()
  // Embed each used font once (a doc can use several families).
  const embedded = new Map<StandardFonts, PDFFont>()
  const fontFor = async (font: FieldFont): Promise<PDFFont> => {
    const id = standardFontFor(font)
    let embeddedFont = embedded.get(id)
    if (!embeddedFont) {
      embeddedFont = await doc.embedFont(id)
      embedded.set(id, embeddedFont)
    }
    return embeddedFont
  }
  // Checkboxes keep the plain Helvetica X.
  const checkboxFont = await fontFor(getFieldFont({}))

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
          font: checkboxFont,
          color: rgb(0, 0, 0),
        })
      }
      continue
    }

    const font = getFieldFont(field)
    const pdfFont = await fontFor(font)

    // Textarea: word-wrap the answer inside the box, starting at the
    // top. Detection stores the box's TOP edge in field.y.
    if (field.type === 'textarea') {
      const wrap = (size: number): string[] => {
        const maxW = field.width - 8
        const lines: string[] = []
        for (const paragraph of text.split('\n')) {
          let line = ''
          for (const word of paragraph.split(/\s+/).filter(Boolean)) {
            const test = line ? `${line} ${word}` : word
            if (pdfFont.widthOfTextAtSize(test, size) <= maxW) {
              line = test
            } else {
              if (line) lines.push(line)
              // A single word wider than the box: hard-split it.
              let w = word
              while (
                pdfFont.widthOfTextAtSize(w, size) > maxW &&
                w.length > 1
              ) {
                let cut = w.length - 1
                while (
                  cut > 0 &&
                  pdfFont.widthOfTextAtSize(w.slice(0, cut), size) > maxW
                ) {
                  cut--
                }
                lines.push(w.slice(0, cut))
                w = w.slice(cut)
              }
              line = w
            }
          }
          lines.push(line)
        }
        return lines
      }
      // Shrink the font so the wrapped text fits the box height.
      let size = font.size
      let lines = wrap(size)
      while (
        size > MIN_FONT_SIZE &&
        lines.length * size * 1.25 > field.height - 8
      ) {
        size -= 0.5
        lines = wrap(size)
      }
      let y = field.y - size - 2
      for (const line of lines) {
        if (y < field.y - field.height + 4) break
        page.drawText(line, {
          x: field.x + 4,
          y,
          size,
          font: pdfFont,
          color: rgb(0, 0, 0),
        })
        y -= size * 1.25
      }
      continue
    }

    // Shrink the font so a long answer fits the blank instead of
    // running over the next label.
    let size = font.size
    while (
      size > MIN_FONT_SIZE &&
      pdfFont.widthOfTextAtSize(text, size) > field.width
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
      font: pdfFont,
      color: rgb(0, 0, 0),
      maxWidth: field.width,
    })
  }

  return doc.save()
}
