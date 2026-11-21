import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { DetectedField, FieldType } from "../lib/fields";
import {
  FONT_FAMILIES,
  getFieldFont,
  type FontFamilyId,
} from "../lib/fonts";
import { fieldReviewIssues } from "../lib/fieldReview";

type FieldPanelProps = {
  pdf: PDFDocumentProxy;
  previewPage: number;
  fields: DetectedField[];
  selectedFieldId: string | null;
  onFieldSelect: (id: string) => void;
  onFieldUpdate: (id: string, patch: Partial<DetectedField>) => void;
  onMoveField: (id: string, direction: -1 | 1) => void;
  onDeleteField: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  previewHeight: number | null;
};

type Filter = "all" | "review" | "excluded";

/** The Setup field panel: one field expanded at a time (the
 * selected one), the rest as one-line rows, in document order.
 * Filter chips narrow the list to fields that need review or are
 * excluded. Selecting a card selects the box on the page; selecting
 * a box scrolls its card into view here. */
export function FieldPanel({
  pdf,
  previewPage,
  fields,
  selectedFieldId,
  onFieldSelect,
  onFieldUpdate,
  onMoveField,
  onDeleteField,
  collapsed,
  onToggleCollapsed,
  previewHeight,
}: FieldPanelProps) {
  const [filter, setFilter] = useState<Filter>("all");
  // The previewed page's size (PDF points), for the "outside the
  // page" review check. Unknown until the page loads.
  const [pageSize, setPageSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    pdf
      .getPage(previewPage)
      .then((page) => {
        if (cancelled) return;
        const vp = page.getViewport({ scale: 1 });
        setPageSize({ width: vp.width, height: vp.height });
      })
      .catch(() => {
        if (!cancelled) setPageSize(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pdf, previewPage]);

  const pageFields = [...fields]
    .filter((field) => field.page === previewPage)
    .sort((a, b) => a.order - b.order);
  const pageIncludedCount = pageFields.filter(
    (field) => field.included,
  ).length;
  const excludedCount = pageFields.filter(
    (field) => !field.included,
  ).length;
  // How many times each label appears on this page — a repeated
  // label gets its section shown as secondary text.
  const labelCounts = new Map<string, number>();
  for (const field of pageFields) {
    labelCounts.set(field.label, (labelCounts.get(field.label) ?? 0) + 1);
  }
  const reviewById = new Map<string, string[]>();
  if (pageSize) {
    for (const field of pageFields) {
      const issues = fieldReviewIssues(
        field,
        pageFields,
        pageSize.width,
        pageSize.height,
      );
      if (issues.length > 0) reviewById.set(field.id, issues);
    }
  }
  const needsReviewCount = reviewById.size;
  const visibleFields = pageFields.filter((field) => {
    if (filter === "review") return reviewById.has(field.id);
    if (filter === "excluded") return !field.included;
    return true;
  });

  // Scroll the selected card into view when the selection changes
  // (e.g. the user clicked a box on the page).
  const cardRefs = useRef(new Map<string, HTMLLIElement>());
  useEffect(() => {
    if (!selectedFieldId) return;
    const el = cardRefs.current.get(selectedFieldId);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedFieldId, filter]);

  return (
    <aside
      className="flex flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm lg:sticky lg:top-6"
      style={
        collapsed || !previewHeight
          ? undefined
          : { height: previewHeight }
      }
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Fields</h2>
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100"
        >
          {collapsed ? "▸ Show" : "▾ Hide"}
        </button>
      </div>
      {!collapsed && (
        <>
          {pageFields.length > 0 ? (
            <>
              <p className="mt-1 text-sm text-gray-600">
                {pageIncludedCount}{" "}
                {pageIncludedCount === 1 ? "field" : "fields"} on page{" "}
                {previewPage}
                {" · "}
                {fields.length} total
              </p>
              <p className="mt-1 text-xs text-gray-600">
                Include in form = the field appears in the Fill form.
                Required = the filler must answer it before downloading.
              </p>
              <div
                className="mt-3 flex flex-wrap gap-1.5"
                role="group"
                aria-label="Filter fields"
              >
                {(
                  [
                    ["all", `All (${pageFields.length})`],
                    ["review", `Needs review (${needsReviewCount})`],
                    ["excluded", `Excluded (${excludedCount})`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    aria-pressed={filter === key}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      filter === key
                        ? "bg-blue-700 text-white"
                        : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
                {visibleFields.length === 0 ? (
                  <p className="mt-2 text-sm text-gray-600">
                    {filter === "review"
                      ? "No fields need review on this page."
                      : "No excluded fields on this page."}
                  </p>
                ) : (
                  <ol className="mt-2 space-y-2">
                    {visibleFields.map((field) => {
                      const isSelected = field.id === selectedFieldId;
                      const issues = reviewById.get(field.id) ?? [];
                      const showSection =
                        (labelCounts.get(field.label) ?? 0) > 1;
                      if (!isSelected) {
                        return (
                          <li
                            key={field.id}
                            ref={(el) => {
                              if (el) cardRefs.current.set(field.id, el);
                              else cardRefs.current.delete(field.id);
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => onFieldSelect(field.id)}
                              className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left hover:bg-gray-50 ${
                                field.included
                                  ? "border-gray-200"
                                  : "border-gray-200 opacity-50"
                              }`}
                            >
                              <span className="shrink-0 text-sm font-medium text-gray-600">
                                {field.order}.
                              </span>
                              <span className="min-w-0 flex-1">
                                <span
                                  className={`block truncate text-sm font-medium ${
                                    field.included ? "" : "line-through"
                                  }`}
                                >
                                  {field.label}
                                </span>
                                {showSection && field.group && (
                                  <span className="block truncate text-xs text-gray-600">
                                    {field.group}
                                  </span>
                                )}
                              </span>
                              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                                {field.type}
                              </span>
                              {issues.length > 0 && (
                                <span
                                  title={`Needs review: ${issues.join(", ")}`}
                                  className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800"
                                >
                                  Review
                                </span>
                              )}
                              <input
                                type="checkbox"
                                checked={field.included}
                                aria-label={`Include field ${field.order}: ${field.label} in the form`}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  onFieldUpdate(field.id, {
                                    included: e.target.checked,
                                  });
                                }}
                                className="h-4 w-4 shrink-0 accent-blue-700"
                              />
                            </button>
                          </li>
                        );
                      }
                      return (
                        <li
                          key={field.id}
                          ref={(el) => {
                            if (el) cardRefs.current.set(field.id, el);
                            else cardRefs.current.delete(field.id);
                          }}
                          className={`rounded-md border px-3 py-2 ${
                            field.included
                              ? "border-blue-600 bg-blue-50"
                              : "border-blue-600 bg-blue-50 opacity-50"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-600">
                              {field.order}.
                            </span>
                            <label
                              htmlFor={`panel-label-${field.id}`}
                              className="sr-only"
                            >
                              Field {field.order} label
                            </label>
                            <input
                              id={`panel-label-${field.id}`}
                              type="text"
                              value={field.label}
                              onChange={(e) =>
                                onFieldUpdate(field.id, {
                                  label: e.target.value,
                                })
                              }
                              className={`min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-sm font-medium ${
                                field.included ? "" : "line-through"
                              }`}
                            />
                            {field.group && (
                              <span
                                title={`Section: ${field.group}`}
                                className="max-w-28 shrink-0 truncate rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-600"
                              >
                                {field.group}
                              </span>
                            )}
                          </div>
                          {issues.length > 0 && (
                            <p className="mt-1 text-xs font-medium text-amber-800">
                              Needs review: {issues.join(", ")}.
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <label
                              htmlFor={`panel-type-${field.id}`}
                              className="sr-only"
                            >
                              Field {field.order} type
                            </label>
                            <select
                              id={`panel-type-${field.id}`}
                              value={field.type}
                              onChange={(e) =>
                                onFieldUpdate(field.id, {
                                  type: e.target.value as FieldType,
                                })
                              }
                              className="rounded border border-gray-300 px-2 py-1 text-sm"
                            >
                              <option value="text">Text</option>
                              <option value="textarea">Long text</option>
                              <option value="date">Date</option>
                              <option value="number">Number</option>
                              <option value="checkbox">Checkbox</option>
                            </select>
                            <label
                              title="The filler must answer this field before downloading"
                              className="flex items-center gap-1 text-sm text-gray-700"
                            >
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(e) =>
                                  onFieldUpdate(field.id, {
                                    required: e.target.checked,
                                  })
                                }
                              />
                              Required
                            </label>
                            <label
                              title="The field appears in the Fill form — uncheck to hide it from fillers"
                              className="flex items-center gap-1 text-sm text-gray-700"
                            >
                              <input
                                type="checkbox"
                                checked={field.included}
                                onChange={(e) =>
                                  onFieldUpdate(field.id, {
                                    included: e.target.checked,
                                  })
                                }
                              />
                              Include in form
                            </label>
                          </div>
                          {field.type !== "checkbox" && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-gray-600">
                                Font
                              </span>
                              <label
                                htmlFor={`panel-font-${field.id}`}
                                className="sr-only"
                              >
                                Field {field.order} font family
                              </label>
                              <select
                                id={`panel-font-${field.id}`}
                                value={getFieldFont(field).family}
                                onChange={(e) =>
                                  onFieldUpdate(field.id, {
                                    fontFamily:
                                      e.target.value as FontFamilyId,
                                  })
                                }
                                className="rounded border border-gray-300 px-2 py-1 text-sm"
                              >
                                {FONT_FAMILIES.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.label}
                                  </option>
                                ))}
                              </select>
                              <label className="flex items-center gap-1 text-sm text-gray-700">
                                <input
                                  type="number"
                                  min="7"
                                  max="24"
                                  step="0.5"
                                  value={getFieldFont(field).size}
                                  aria-label={`Field ${field.order} font size`}
                                  onChange={(e) => {
                                    const parsed = parseFloat(
                                      e.target.value,
                                    );
                                    if (
                                      Number.isFinite(parsed) &&
                                      parsed >= 7 &&
                                      parsed <= 24
                                    ) {
                                      onFieldUpdate(field.id, {
                                        fontSize: parsed,
                                        height: Math.max(
                                          field.height,
                                          parsed + 4,
                                        ),
                                      });
                                    }
                                  }}
                                  className="w-16 rounded border border-gray-300 px-1 py-1 text-sm"
                                />
                                pt
                              </label>
                              <label
                                title="Bold"
                                className="flex items-center gap-1 text-sm text-gray-700"
                              >
                                <input
                                  type="checkbox"
                                  checked={getFieldFont(field).bold}
                                  aria-label={`Field ${field.order} bold`}
                                  onChange={(e) =>
                                    onFieldUpdate(field.id, {
                                      bold: e.target.checked,
                                    })
                                  }
                                />
                                <span className="font-bold">B</span>
                              </label>
                              <label
                                title="Italic"
                                className="flex items-center gap-1 text-sm text-gray-700"
                              >
                                <input
                                  type="checkbox"
                                  checked={getFieldFont(field).italic}
                                  aria-label={`Field ${field.order} italic`}
                                  onChange={(e) =>
                                    onFieldUpdate(field.id, {
                                      italic: e.target.checked,
                                    })
                                  }
                                />
                                <span className="italic">I</span>
                              </label>
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                            {(
                              [
                                ["X", field.x],
                                ["Y", field.y],
                                ["W", field.width],
                                ["H", field.height],
                              ] as const
                            ).map(([key, value]) => (
                              <label
                                key={key}
                                className="flex items-center gap-1"
                              >
                                {key}
                                <input
                                  type="number"
                                  step="1"
                                  value={Math.round(value * 10) / 10}
                                  aria-label={`Field ${field.order} ${key}`}
                                  onChange={(e) => {
                                    const parsed = parseFloat(
                                      e.target.value,
                                    );
                                    if (Number.isFinite(parsed)) {
                                      onFieldUpdate(field.id, {
                                        [key.toLowerCase()]: parsed,
                                      } as Partial<DetectedField>);
                                    }
                                  }}
                                  className="w-16 rounded border border-gray-300 px-1 py-0.5 text-xs"
                                />
                              </label>
                            ))}
                            <span className="text-gray-600">
                              drag on page, or use arrow keys
                            </span>
                          </div>
                          <div className="mt-2 flex items-center gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onMoveField(field.id, -1);
                              }}
                              disabled={fields.indexOf(field) === 0}
                              aria-label={`Move field ${field.order} up`}
                              className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40"
                            >
                              ↑ Up
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onMoveField(field.id, 1);
                              }}
                              disabled={
                                fields.indexOf(field) === fields.length - 1
                              }
                              aria-label={`Move field ${field.order} down`}
                              className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-40"
                            >
                              ↓ Down
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteField(field.id);
                              }}
                              aria-label={`Delete field ${field.order}`}
                              className="ml-auto rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-600">
              No fields on this page — turn on “+ Add field” and click on
              the page to add one.
            </p>
          )}
          <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-600">
            Tip: click a field to highlight it on the page. Drag the
            highlighted box to move it, drag its corners to resize it, or
            type the exact X / Y / W / H above. Turn on “+ Add field” to
            add a field by clicking the page. Ctrl+Z undoes a field
            change.
          </p>
        </>
      )}
    </aside>
  );
}
