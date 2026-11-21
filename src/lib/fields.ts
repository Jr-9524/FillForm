import type { FontFamilyId } from "./fonts";

export type FieldType = "text" | "date" | "number" | "textarea" | "checkbox";

/**
 * One blank in a PDF that needs input.
 * x / y / width / height are in PDF points, origin bottom-left —
 * the same coordinate system pdf-lib uses later, so an overlay lands
 * in the same place at any zoom or print size.
 */
export type DetectedField = {
  id: string;
  page: number; // 1-based
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  type: FieldType;
  order: number; // 1-based, document order
  included: boolean; // false = excluded from the form, but kept in the list
  required: boolean;
  group: string; // section heading above the field, e.g. "STUDENT INFORMATION"
  // Font for the answer (see src/lib/fonts.ts). Optional so fields
  // created before the font editor existed still load — getFieldFont
  // fills in Helvetica 12pt regular.
  fontFamily?: FontFamilyId;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
};

/** Sort fields in document order (page, top-to-bottom, left-to-right) and number them. */
export function sortAndOrderFields(fields: DetectedField[]): DetectedField[] {
  const deduped = fields.filter(
    (field, index) =>
      fields.findIndex(
        (other) =>
          other.page === field.page &&
          Math.abs(other.x - field.x) < 5 &&
          Math.abs(other.y - field.y) < 5,
      ) === index,
  );
  return deduped
    .slice()
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
    .map((field, index) => ({ ...field, order: index + 1 }));
}

/** Re-number fields 1..n in their current list order (used after a manual move — no re-sorting). */
export function renumberFields(fields: DetectedField[]): DetectedField[] {
  return fields.map((field, index) => ({ ...field, order: index + 1 }));
}

export function createManualField(
  page: number,
  x: number,
  y: number,
  label: string,
): DetectedField {
  return {
    id: `manual-${Date.now()}`,
    page,
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    width: 150,
    height: 16,
    label,
    type: "text",
    order: 0,
    included: true,
    required: false,
    group: "",
    fontFamily: "helvetica",
    fontSize: 12,
    bold: false,
    italic: false,
  };
}
