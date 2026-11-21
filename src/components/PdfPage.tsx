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
};

const RENDER_SCALE = 1.5;

/** Renders one PDF page to a canvas, with its page number below it. */
export function PdfPage({
  pdf,
  pageNumber,
  pageCount,
  onPageClick,
  fields = [],
  selectedFieldId = null,
  onFieldSelect,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageSizeRef = useRef({ width: 0, height: 0 });
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);

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

  function handleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!onPageClick) return;
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
        <div className="relative max-w-full">
          <canvas
            ref={canvasRef}
            className="max-w-full"
            onClick={handleClick}
          />
          {pageSize.width > 0 &&
            pageFields.map((field) => {
              const isSelected = field.id === selectedFieldId;
              // Percentages, so the box stays aligned if the canvas
              // is scaled down by CSS. PDF y is bottom-up, CSS is top-down.
              // Detection y is the blank line itself, so a text box
              // straddles it (5pt below to 9pt above) instead of
              // floating above it; a checkbox box is the square itself.
              const left = (field.x / pageSize.width) * 100;
              const width = (field.width / pageSize.width) * 100;
              const isCheckbox = field.type === "checkbox";
              const top =
                ((pageSize.height -
                  field.y -
                  (isCheckbox ? field.height : 9)) /
                  pageSize.height) *
                100;
              const height =
                ((isCheckbox ? field.height : 14) / pageSize.height) * 100;
              return (
                <button
                  key={field.id}
                  type="button"
                  aria-label={`Field ${field.order}: ${field.label}`}
                  title={`${field.order}. ${field.label}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onFieldSelect?.(field.id);
                  }}
                  className={`absolute rounded-sm ${
                    isSelected
                      ? "border-2 border-blue-600 bg-blue-500/30"
                      : "border border-blue-400/60 bg-blue-400/10 hover:bg-blue-400/25"
                  }`}
                  style={{
                    left: `${left}%`,
                    top: `${top}%`,
                    width: `${Math.max(width, 1)}%`,
                    height: `${height}%`,
                  }}
                />
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
