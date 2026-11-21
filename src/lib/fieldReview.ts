import type { DetectedField } from "./fields";

export type FieldReviewIssue = "overlap" | "outside" | "tiny";

/** A field's box in PDF points, as { x1, y1, x2, y2 } with y1 the
 * bottom edge and y2 the top edge. Mirrors PdfPage's displayBox
 * geometry: a text/checkbox field's y is its baseline (bottom of
 * the box), a textarea's y is its top edge. */
export function fieldBox(field: DetectedField): {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
} {
  const x1 = field.x;
  const x2 = field.x + field.width;
  if (field.type === "textarea") {
    return { x1, y1: field.y - field.height, x2, y2: field.y };
  }
  return { x1, y1: field.y, x2, y2: field.y + field.height };
}

/** Why a field "needs review", computed in the UI layer only —
 * detection and the stored field are untouched. A field needs
 * review when its box overlaps another field on the same page,
 * extends outside the page, or is very small. */
export function fieldReviewIssues(
  field: DetectedField,
  pageFields: DetectedField[],
  pageWidth: number,
  pageHeight: number,
): FieldReviewIssue[] {
  const issues: FieldReviewIssue[] = [];
  const box = fieldBox(field);
  if (
    box.x1 < 0 ||
    box.y1 < 0 ||
    box.x2 > pageWidth ||
    box.y2 > pageHeight
  ) {
    issues.push("outside");
  }
  if (box.x2 - box.x1 < 12 || box.y2 - box.y1 < 6) {
    issues.push("tiny");
  }
  for (const other of pageFields) {
    if (other.id === field.id) continue;
    const o = fieldBox(other);
    // A real overlap, not just touching edges (0.5pt tolerance).
    if (
      box.x1 < o.x2 - 0.5 &&
      box.x2 > o.x1 + 0.5 &&
      box.y1 < o.y2 - 0.5 &&
      box.y2 > o.y1 + 0.5
    ) {
      issues.push("overlap");
      break;
    }
  }
  return issues;
}
