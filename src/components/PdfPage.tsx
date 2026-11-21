import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { DetectedField } from "../lib/fields";

type PdfPageProps = {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  pageCount: number;
  /** Called with the clicked position in PDF points (origin bottom-left). */
  onPageClick?: (pageNumber: number, x: number, y: number) => void;
  /** Detected fields on this page, drawn as highlight boxes. */
  fields?: DetectedField[];
  /** Id of the field selected in the list — drawn with a strong highlight. */
  selectedFieldId?: string | null;
  /** Called when a highlight box is clicked. */
  onFieldSelect?: (id: string) => void;
  /** Called live while a box is dragged or resized. */
  onFieldUpdate?: (id: string, patch: Partial<DetectedField>) => void;
};

const RENDER_SCALE = 1.5;

/** A highlight box in PDF points, measured from the page's top edge. */
type DisplayBox = { left: number; top: number; width: number; height: number };

/** Renders one PDF page to a canvas, with its page number below it. */
export function PdfPage({
  pdf,
  pageNumber,
  pageCount,
  onPageClick,
  fields = [],
  selectedFieldId = null,
  onFieldSelect,
  onFieldUpdate,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageSizeRef = useRef({ width: 0, height: 0 });
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  // A drag that just ended — the click that follows it must not add
  // a field on the canvas.
  const dragEndAtRef = useRef(0);
  // Live drag state, kept in a ref so pointermove does not re-render
  // through state on every pixel.
  const dragRef = useRef<{
    field: DetectedField;
    mode: "move" | "nw" | "ne" | "sw" | "se";
    startX: number;
    startY: number;
    startBox: DisplayBox;
    moved: boolean;
  } | null>(null);

  const pageFields = fields.filter((field) => field.page === pageNumber);

  useEffect(() => {
    let cancelled = false;
    let renderTask: ReturnType<
      Awaited<ReturnType<typeof pdf.getPage>>["render"]
    > | null = null;

    async function render() {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: RENDER_SCALE });
        const size = {
          width: viewport.width / RENDER_SCALE,
          height: viewport.height / RENDER_SCALE,
        };
        pageSizeRef.current = size;
        setPageSize(size);
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        // pdf.js v6 wants the canvas element itself, not its 2D context.
        renderTask = page.render({ canvas, viewport });
        await renderTask.promise;
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not render page.",
          );
        }
      }
    }

    void render();

    return () => {
      cancelled = true;
      // Cancel an in-flight render so a fast re-render (e.g. React
      // StrictMode, or a new file) does not draw over this canvas.
      void renderTask?.cancel();
    };
  }, [pdf, pageNumber]);

  // The box as drawn, in PDF points from the page's top edge.
  // Detection y is the blank line itself, so a text box straddles it
  // (5pt below to height-5 above); a checkbox box is the square
  // itself; a textarea's y is the TOP of its box, so the box is
  // drawn full-size.
  function displayBox(field: DetectedField): DisplayBox {
    const ph = pageSizeRef.current.height;
    if (field.type === "textarea") {
      return { left: field.x, top: ph - field.y, width: field.width, height: field.height };
    }
    if (field.type === "checkbox") {
      return {
        left: field.x,
        top: ph - field.y - field.height,
        width: field.width,
        height: field.height,
      };
    }
    return {
      left: field.x,
      top: ph - field.y - (field.height - 5),
      width: field.width,
      height: field.height,
    };
  }

  // Convert a dragged display box back to the field's stored
  // coordinates (which differ per type — see displayBox).
  function boxToPatch(
    field: DetectedField,
    box: DisplayBox,
  ): Partial<DetectedField> {
    const ph = pageSizeRef.current.height;
    const width = Math.max(10, Math.round(box.width * 10) / 10);
    const height = Math.max(5, Math.round(box.height * 10) / 10);
    const x = Math.max(0, Math.round(box.left * 10) / 10);
    if (field.type === "textarea") {
      return { x, y: Math.round((ph - box.top) * 10) / 10, width, height };
    }
    if (field.type === "checkbox") {
      // Keep checkboxes square — the vertical size defines it.
      return {
        x,
        y: Math.round((ph - box.top - height) * 10) / 10,
        width: height,
        height,
      };
    }
    return {
      x,
      y: Math.round((ph - box.top - (height - 5)) * 10) / 10,
      width,
      height,
    };
  }

  function startDrag(
    event: React.PointerEvent,
    field: DetectedField,
    mode: "move" | "nw" | "ne" | "sw" | "se",
  ) {
    if (event.button !== 0 || !onFieldUpdate) return;
    event.preventDefault();
    event.stopPropagation();
    onFieldSelect?.(field.id);
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    dragRef.current = {
      field,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startBox: displayBox(field),
      moved: false,
    };
  }

  function handleDragMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag || !onFieldUpdate) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const scaleX = pageSizeRef.current.width / rect.width;
    const scaleY = pageSizeRef.current.height / rect.height;
    const dx = (event.clientX - drag.startX) * scaleX;
    const dy = (event.clientY - drag.startY) * scaleY;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) drag.moved = true;
    const s = drag.startBox;
    const ph = pageSizeRef.current.height;
    const pw = pageSizeRef.current.width;
    let box: DisplayBox;
    if (drag.mode === "move") {
      box = {
        left: Math.max(0, Math.min(pw - s.width, s.left + dx)),
        top: Math.max(0, Math.min(ph - s.height, s.top + dy)),
        width: s.width,
        height: s.height,
      };
    } else {
      const left =
        drag.mode === "nw" || drag.mode === "sw"
          ? Math.max(0, Math.min(s.left + s.width - 10, s.left + dx))
          : s.left;
      const top =
        drag.mode === "nw" || drag.mode === "ne"
          ? Math.max(0, Math.min(s.top + s.height - 5, s.top + dy))
          : s.top;
      const width =
        drag.mode === "nw" || drag.mode === "sw"
          ? Math.max(10, s.width - dx)
          : Math.max(10, s.width + dx);
      const height =
        drag.mode === "nw" || drag.mode === "ne"
          ? Math.max(5, s.height - dy)
          : Math.max(5, s.height + dy);
      box = {
        left: Math.min(left, pw - 10),
        top: Math.min(top, ph - 5),
        width: Math.min(width, pw - left),
        height: Math.min(height, ph - top),
      };
    }
    onFieldUpdate(drag.field.id, boxToPatch(drag.field, box));
  }

  function endDrag(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.moved) dragEndAtRef.current = Date.now();
    (event.currentTarget as HTMLElement).releasePointerCapture?.(
      event.pointerId,
    );
  }

  function handleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!onPageClick) return;
    // A drag that just ended also fires a click where it lands —
    // that click must not add a field.
    if (Date.now() - dragEndAtRef.current < 200) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // The canvas may be scaled down by CSS, so convert CSS pixels
    // back to canvas pixels, then to PDF points.
    const scale = canvas.width / rect.width;
    const xPt = ((event.clientX - rect.left) * scale) / RENDER_SCALE;
    const yFromTopPt = ((event.clientY - rect.top) * scale) / RENDER_SCALE;
    const yPt = pageSizeRef.current.height - yFromTopPt;
    onPageClick(
      pageNumber,
      Math.max(0, Math.min(pageSizeRef.current.width, xPt)),
      Math.max(0, Math.min(pageSizeRef.current.height, yPt)),
    );
  }

  // Corner handles for the selected box, positioned from the box's
  // own left/top/width/height (percentages of the page container).
  function handleStyle(
    key: "nw" | "ne" | "sw" | "se",
    left: number,
    top: number,
    width: number,
    height: number,
  ): { left: string; top: string; cursor: string } {
    const x =
      key === "nw" || key === "sw"
        ? `calc(${left}% - 5px)`
        : `calc(${left + width}% - 5px)`;
    const y =
      key === "nw" || key === "ne"
        ? `calc(${top}% - 5px)`
        : `calc(${top + height}% - 5px)`;
    const cursor =
      key === "nw" || key === "se" ? "nwse-resize" : "nesw-resize";
    return { left: x, top: y, cursor };
  }

  return (
    <figure
      id={`page-${pageNumber}`}
      className={`mx-auto w-fit rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${onPageClick ? "cursor-crosshair" : ""}`}
      title={onPageClick ? "Click to add a field here" : undefined}
    >
      {error ? (
        <p className="max-w-md text-sm text-red-600">
          Page {pageNumber} failed to render: {error}
        </p>
      ) : (
        <div ref={containerRef} className="relative max-w-full">
          <canvas
            ref={canvasRef}
            className="max-w-full"
            onClick={handleClick}
          />
          {pageSize.width > 0 &&
            pageFields.map((field) => {
              const isSelected = field.id === selectedFieldId;
              // Percentages, so the box stays aligned if the canvas
              // is scaled down by CSS.
              const box = displayBox(field);
              const left = (box.left / pageSize.width) * 100;
              const top = (box.top / pageSize.height) * 100;
              const width = (box.width / pageSize.width) * 100;
              const height = (box.height / pageSize.height) * 100;
              return (
                <div key={field.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Field ${field.order}: ${field.label}`}
                    title={`${field.order}. ${field.label}${onFieldUpdate ? " — drag to move, corners to resize" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onFieldSelect?.(field.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onFieldSelect?.(field.id);
                      }
                    }}
                    onPointerDown={(e) => startDrag(e, field, "move")}
                    onPointerMove={handleDragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    className={`absolute touch-none rounded-sm ${
                      isSelected
                        ? "cursor-move border-2 border-blue-600 bg-blue-500/30"
                        : "cursor-pointer border border-blue-400/60 bg-blue-400/10 hover:bg-blue-400/25"
                    }`}
                    style={{
                      left: `${left}%`,
                      top: `${top}%`,
                      width: `${Math.max(width, 1)}%`,
                      height: `${height}%`,
                    }}
                  />
                  {isSelected &&
                    onFieldUpdate &&
                    (["nw", "ne", "sw", "se"] as const).map((key) => {
                      const style = handleStyle(key, left, top, width, height);
                      return (
                        <div
                          key={key}
                          role="button"
                          tabIndex={-1}
                          aria-label={`Resize ${field.label} (${key})`}
                          onPointerDown={(e) => startDrag(e, field, key)}
                          onPointerMove={handleDragMove}
                          onPointerUp={endDrag}
                          onPointerCancel={endDrag}
                          className="absolute z-10 h-2.5 w-2.5 touch-none rounded-sm border border-blue-700 bg-white shadow"
                          style={{
                            left: style.left,
                            top: style.top,
                            cursor: style.cursor,
                          }}
                        />
                      );
                    })}
                </div>
              );
            })}
        </div>
      )}
      <figcaption className="mt-2 text-center text-sm text-gray-500">
        Page {pageNumber} of {pageCount}
      </figcaption>
    </figure>
  );
}
