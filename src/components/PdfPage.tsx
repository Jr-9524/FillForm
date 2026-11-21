import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { DetectedField } from "../lib/fields";
import {
  fitSingleLineSize,
  fitTextarea,
} from "../lib/fitText";
import {
  cssFontFamily,
  getFieldFont,
} from "../lib/fonts";

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
  /** Current answers by field id — shown live on the page. */
  answers?: Record<string, string>;
  /** When true, render the answers on the page instead of the
   * draggable highlight boxes (Fill mode: what you type is what
   * downloads). */
  showAnswers?: boolean;
  /** Zoom factor for the preview (1 = fit the column). The parent
   * owns it so it survives paging. */
  zoom?: number;
  /** Called when the user changes the zoom from the toolbar. */
  onZoomChange?: (zoom: number) => void;
  /** When true, every Setup box shows its placeholder text. When
   * false (default), only the selected or hovered box does, so the
   * placeholders do not hide the printed form underneath. */
  showAllPlaceholders?: boolean;
};

const RENDER_SCALE = 1.5;

/** Zoom steps the toolbar offers (1 = fit the column). */
export const ZOOM_LEVELS = [1, 1.25, 1.5, 2, 2.5, 3];

// Padding inside a text box, in PDF points: the answer sits 4pt
// in from the left and right edges and the box is at least the
// font size + 4pt tall, so the text never touches the box edges.
const BOX_PAD = 4;

/** Smallest height a text / textarea box may have: its font size plus padding. */
function minBoxHeight(field: DetectedField): number {
  return getFieldFont(field).size + BOX_PAD;
}

// Placeholder shown inside Setup boxes so the creator can see what
// a filled box looks like. The single line is long on purpose —
// overflow cuts it at the box's right edge, so it runs "all the way".
const LOREM_LINE =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.";
const LOREM_BLOCK = `${LOREM_LINE} ${LOREM_LINE} ${LOREM_LINE} ${LOREM_LINE}`;

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
  answers = {},
  showAnswers = false,
  zoom = 1,
  onZoomChange,
  showAllPlaceholders = false,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pageSizeRef = useRef({ width: 0, height: 0 });
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);
  // Field under the mouse — its placeholder shows even when it is
  // not selected, so the creator can preview one box at a time
  // without all the placeholders hiding the form.
  const [hoveredFieldId, setHoveredFieldId] = useState<string | null>(null);
  // Displayed width of the page (CSS px) — the answer text is sized
  // from it, so it stays in scale with the canvas at any width.
  const [displayWidth, setDisplayWidth] = useState(0);
  // CSS px per PDF point at the current display size.
  const scale =
    displayWidth > 0 && pageSize.width > 0
      ? displayWidth / pageSize.width
      : 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setDisplayWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
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
        // Render sharper when zoomed in (capped at 3x) so the page
        // does not blur as it grows past its fit size.
        const renderScale = Math.min(RENDER_SCALE * zoom, 3);
        const viewport = page.getViewport({ scale: renderScale });
        const size = {
          width: viewport.width / renderScale,
          height: viewport.height / renderScale,
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
  }, [pdf, pageNumber, zoom]);

  // Display box (PDF points from the page top) for a field. A text
  // field's y is the text baseline — the drawn line itself — and the
  // box sits ON that line: its bottom edge is the baseline, so the
  // box is the writing area above the line, the way a text input
  // sits on an underline. Dragging the box so its bottom edge is on
  // the line puts the answer's baseline exactly on the line, which is
  // where the download draws it. (An earlier split put 3pt of the box
  // below the line and the rest above; the box then read as floating
  // above the line and, when a user aligned its bottom edge with the
  // line, the answer landed 3pt above it.) The box is never shorter
  // than its font size + padding, so the text always fits with room
  // around it. A checkbox box is the square itself; a textarea's y
  // is the TOP of its box, so the box is drawn full-size.
  function displayBox(field: DetectedField): DisplayBox {
    const ph = pageSizeRef.current.height;
    if (field.type === "textarea") {
      const height = Math.max(field.height, minBoxHeight(field));
      return { left: field.x, top: ph - field.y, width: field.width, height };
    }
    if (field.type === "checkbox") {
      return {
        left: field.x,
        top: ph - field.y - field.height,
        width: field.width,
        height: field.height,
      };
    }
    const height = Math.max(field.height, minBoxHeight(field));
    return {
      left: field.x,
      top: ph - field.y - height,
      width: field.width,
      height,
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
    // A text / textarea box never shrinks below its font size +
    // padding, so the answer always fits with room around it.
    const minHeight =
      field.type === "checkbox" ? 5 : minBoxHeight(field);
    const height = Math.max(minHeight, Math.round(box.height * 10) / 10);
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
      y: Math.round((ph - box.top - height) * 10) / 10,
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
      // Resize: the box never shrinks below its minimum height
      // (font size + padding for text, 5pt for a checkbox square).
      const minH =
        drag.field.type === "checkbox" ? 5 : minBoxHeight(drag.field);
      const left =
        drag.mode === "nw" || drag.mode === "sw"
          ? Math.max(0, Math.min(s.left + s.width - 10, s.left + dx))
          : s.left;
      const top =
        drag.mode === "nw" || drag.mode === "ne"
          ? Math.max(0, Math.min(s.top + s.height - minH, s.top + dy))
          : s.top;
      const width =
        drag.mode === "nw" || drag.mode === "sw"
          ? Math.max(10, s.width - dx)
          : Math.max(10, s.width + dx);
      const height =
        drag.mode === "nw" || drag.mode === "ne"
          ? Math.max(minH, s.height - dy)
          : Math.max(minH, s.height + dy);
      box = {
        left: Math.min(left, pw - 10),
        top: Math.min(top, ph - minH),
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
  // Handles are 12px so they are grabbable; the -6px offset centres
  // each one on its corner.
  function handleStyle(
    key: "nw" | "ne" | "sw" | "se",
    left: number,
    top: number,
    width: number,
    height: number,
  ): { left: string; top: string; cursor: string } {
    const x =
      key === "nw" || key === "sw"
        ? `calc(${left}% - 6px)`
        : `calc(${left + width}% - 6px)`;
    const y =
      key === "nw" || key === "ne"
        ? `calc(${top}% - 6px)`
        : `calc(${top + height}% - 6px)`;
    const cursor =
      key === "nw" || key === "se" ? "nwse-resize" : "nesw-resize";
    return { left: x, top: y, cursor };
  }

  // Nudge the selected field with the arrow keys: 1pt per press,
  // 10pt with Shift — precise placement without dragging a tiny
  // box. Up on screen is +y (PDF points run from the bottom).
  function handleBoxKeyDown(
    event: React.KeyboardEvent,
    field: DetectedField,
  ) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onFieldSelect?.(field.id);
      return;
    }
    if (!onFieldUpdate) return;
    const step = event.shiftKey ? 10 : 1;
    let dx = 0;
    let dy = 0;
    if (event.key === "ArrowLeft") dx = -step;
    else if (event.key === "ArrowRight") dx = step;
    else if (event.key === "ArrowUp") dy = step;
    else if (event.key === "ArrowDown") dy = -step;
    else return;
    event.preventDefault();
    onFieldSelect?.(field.id);
    // Up on screen is +y for every type: a text field's y is its
    // baseline and a textarea's y is its top edge, and both rise
    // when the box moves up the page (PDF points run from the
    // bottom).
    onFieldUpdate(field.id, {
      x: Math.max(0, Math.round((field.x + dx) * 10) / 10),
      y: Math.max(0, Math.round((field.y + dy) * 10) / 10),
    });
  }

  // Zoom toolbar: step through the levels, or back to Fit (1x).
  // The parent owns the zoom value so it survives paging.
  const zoomIndex = Math.max(
    0,
    ZOOM_LEVELS.findIndex((z) => z >= zoom - 0.001),
  );
  function setZoomLevel(index: number) {
    const next = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index))];
    onZoomChange?.(next);
  }

  return (
    <div>
      {onZoomChange && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Zoom</span>
          <button
            type="button"
            onClick={() => setZoomLevel(zoomIndex - 1)}
            disabled={zoomIndex <= 0}
            aria-label="Zoom out"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm hover:bg-gray-100 disabled:opacity-40"
          >
            −
          </button>
          <span className="w-12 text-center text-sm text-gray-700">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoomLevel(zoomIndex + 1)}
            disabled={zoomIndex >= ZOOM_LEVELS.length - 1}
            aria-label="Zoom in"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm hover:bg-gray-100 disabled:opacity-40"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => onZoomChange(1)}
            disabled={zoom === 1}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm hover:bg-gray-100 disabled:opacity-40"
          >
            Fit
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
    <figure
      id={`page-${pageNumber}`}
      className={`mx-auto w-fit rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${onPageClick ? "cursor-crosshair" : ""}`}
      title={onPageClick ? "Click to add a field here" : undefined}
      style={
        zoom > 1
          ? { width: `${zoom * 100}%`, marginLeft: 0, marginRight: 0 }
          : undefined
      }
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
            !showAnswers &&
            pageFields.map((field) => {
              const isSelected = field.id === selectedFieldId;
              // Percentages, so the box stays aligned if the canvas
              // is scaled down by CSS.
              const box = displayBox(field);
              const left = (box.left / pageSize.width) * 100;
              const top = (box.top / pageSize.height) * 100;
              const width = (box.width / pageSize.width) * 100;
              const height = (box.height / pageSize.height) * 100;
              // Placeholder preview inside the box, matching the
              // field's type: a check mark for checkboxes, a date
              // for dates, a number for numbers, lorem ipsum for
              // text, wrapped lorem ipsum for textareas. It uses the
              // field's own font, so the preview looks like the
              // answer will look.
              const placeholder =
                field.type === "checkbox"
                  ? "✓"
                  : field.type === "date"
                    ? "01/15/2026"
                    : field.type === "number"
                      ? "123"
                      : field.type === "textarea"
                        ? LOREM_BLOCK
                        : LOREM_LINE;
              const font = getFieldFont(field);
              const placeholderSize =
                field.type === "checkbox" ? 10 : font.size;
              return (
                <div key={field.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`Field ${field.order}: ${field.label}`}
                    title={`${field.order}. ${field.label}${onFieldUpdate ? " — drag to move, corners to resize, arrow keys nudge 1pt (Shift: 10pt)" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onFieldSelect?.(field.id);
                    }}
                    onPointerDown={(e) => startDrag(e, field, "move")}
                    onPointerMove={handleDragMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onMouseEnter={() => setHoveredFieldId(field.id)}
                    onMouseLeave={() => setHoveredFieldId(null)}
                    onKeyDown={(e) => handleBoxKeyDown(e, field)}
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
                  >
                    {/* Invisible grab area, 4pt past the box on every
                        side: the boxes are only ~15px tall on screen
                        and some sit ~2px apart, so the visible edge
                        alone is too small a target to grab reliably.
                        Pointer events bubble to this box, so a press
                        on the padding still drags this field. */}
                    <span
                      aria-hidden
                      className="absolute -inset-1"
                    />
                    {scale > 0 &&
                      (showAllPlaceholders ||
                        isSelected ||
                        hoveredFieldId === field.id) && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 overflow-hidden text-gray-500"
                        style={{
                          fontSize: `${placeholderSize * scale}px`,
                          lineHeight:
                            field.type === "textarea" ? 1.25 : 1,
                          fontFamily: cssFontFamily(font),
                          fontStyle: font.italic ? "italic" : "normal",
                          fontWeight: font.bold ? 700 : 400,
                          // Padding inside the box, matching the
                          // download (answers start 4pt in from the
                          // left edge): the text never touches the
                          // box's sides.
                          padding:
                            field.type === "checkbox"
                              ? 0
                              : `0 ${BOX_PAD * scale}px`,
                          whiteSpace:
                            field.type === "textarea" ? "normal" : "nowrap",
                          display: "flex",
                          alignItems:
                            field.type === "checkbox"
                              ? "center"
                              : field.type === "textarea"
                                ? "flex-start"
                                : "flex-end",
                          justifyContent:
                            field.type === "checkbox"
                              ? "center"
                              : "flex-start",
                        }}
                      >
                        {placeholder}
                      </span>
                    )}
                  </div>
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
                          className="absolute z-10 h-3 w-3 touch-none rounded-sm border border-blue-700 bg-white shadow"
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
          {pageSize.width > 0 &&
            showAnswers &&
            displayWidth > 0 &&
            pageFields.map((field) => {
              if (!field.included) return null;
              const text = (answers[field.id] ?? "").trim();
              if (!text) return null;
              const ph = pageSize.height;
              const pw = pageSize.width;
              if (field.type === "checkbox") {
                if (!["true", "checked", "yes", "x"].includes(text.toLowerCase()))
                  return null;
                return (
                  <div
                    key={field.id}
                    aria-hidden
                    className="pointer-events-none absolute flex items-center justify-center font-bold text-black"
                    style={{
                      left: `${(field.x / pw) * 100}%`,
                      top: `${((ph - field.y - field.height) / ph) * 100}%`,
                      width: `${(field.width / pw) * 100}%`,
                      height: `${(field.height / ph) * 100}%`,
                      fontSize: `${10 * scale}px`,
                      fontFamily: "Helvetica, Arial, sans-serif",
                    }}
                  >
                    X
                  </div>
                );
              }
              const font = getFieldFont(field);
              if (field.type === "textarea") {
                const { size, lines } = fitTextarea(
                  text,
                  field.width - 8,
                  field.height,
                  font,
                );
                return (
                  <div
                    key={field.id}
                    aria-hidden
                    className="pointer-events-none absolute overflow-hidden text-black"
                    style={{
                      left: `${((field.x + 4) / pw) * 100}%`,
                      top: `${((ph - field.y) / ph) * 100}%`,
                      width: `${((field.width - 8) / pw) * 100}%`,
                      height: `${(field.height / ph) * 100}%`,
                      fontSize: `${size * scale}px`,
                      lineHeight: 1.25,
                      fontFamily: cssFontFamily(font),
                      fontStyle: font.italic ? "italic" : "normal",
                      fontWeight: font.bold ? 700 : 400,
                    }}
                  >
                    {lines.map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < lines.length - 1 && <br />}
                      </span>
                    ))}
                  </div>
                );
              }
              const size = fitSingleLineSize(text, field.width, font);
              return (
                <div
                  key={field.id}
                  aria-hidden
                  className="pointer-events-none absolute overflow-hidden whitespace-nowrap text-black"
                  style={{
                    left: `${((field.x + 4) / pw) * 100}%`,
                    // The div's top is the text's cap top, not its
                    // baseline: in a lineHeight-1 line the baseline
                    // sits ~0.85em below the div top, so the top is
                    // placed 0.85*size above the field's y (the
                    // line) to put the baseline exactly on it,
                    // matching the downloaded PDF.
                    top: `${((ph - field.y - size * 0.85) / ph) * 100}%`,
                    fontSize: `${size * scale}px`,
                    lineHeight: 1,
                    fontFamily: cssFontFamily(font),
                    fontStyle: font.italic ? "italic" : "normal",
                    fontWeight: font.bold ? 700 : 400,
                  }}
                >
                  {text}
                </div>
              );
            })}
        </div>
      )}
      <figcaption className="mt-2 text-center text-sm text-gray-500">
        Page {pageNumber} of {pageCount}
      </figcaption>
    </figure>
      </div>
    </div>
  );
}
