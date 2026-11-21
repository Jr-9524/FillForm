/**
 * Font choices for a field's answer.
 *
 * The three families map to pdf-lib's built-in StandardFonts
 * (Helvetica, Times Roman, Courier) plus their bold / italic
 * variants, so the download needs no font files. The same family
 * is used for the browser preview and for measuring text width.
 */

export type FontFamilyId = "helvetica" | "times" | "courier";

export const FONT_FAMILIES: {
  id: FontFamilyId;
  label: string;
  css: string;
}[] = [
  { id: "helvetica", label: "Helvetica", css: "Helvetica, Arial, sans-serif" },
  { id: "times", label: "Times New Roman", css: "'Times New Roman', Times, serif" },
  { id: "courier", label: "Courier", css: "Courier, 'Courier New', monospace" },
];

export const DEFAULT_FONT_SIZE = 12;
/** Smallest size a fitted answer shrinks to (same as the download). */
export const MIN_FONT_SIZE = 7;

export type FieldFont = {
  family: FontFamilyId;
  size: number;
  bold: boolean;
  italic: boolean;
};

/** Font settings for a field, with defaults for fields created before the font editor existed. */
export function getFieldFont(field: {
  fontFamily?: FontFamilyId;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
}): FieldFont {
  return {
    family: field.fontFamily ?? "helvetica",
    size: field.fontSize ?? DEFAULT_FONT_SIZE,
    bold: field.bold ?? false,
    italic: field.italic ?? false,
  };
}

/** CSS font shorthand for the browser (preview + measuring), e.g. "italic bold 12px 'Times New Roman', Times, serif". */
export function cssFontString(font: FieldFont, sizePt: number): string {
  const style = font.italic ? "italic" : "normal";
  const weight = font.bold ? "bold" : "normal";
  return `${style} ${weight} ${sizePt}px ${cssFontFamily(font)}`;
}

/** Just the CSS font-family stack for a field's family. */
export function cssFontFamily(font: FieldFont): string {
  return (
    FONT_FAMILIES.find((f) => f.id === font.family)?.css ?? FONT_FAMILIES[0].css
  );
}
