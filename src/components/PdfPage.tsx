import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfPageProps = {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  pageCount: number;
  /** Called with the clicked position in PDF points (origin bottom-left). */
  onPageClick?: (pageNumber: number, x: number, y: number) => void;
};

const RENDER_SCALE = 1.5;

/** Renders one PDF page to a canvas, with its page number below it. */
export function PdfPage({
  pdf,
  pageNumber,
  pageCount,
  onPageClick,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageSizeRef = useRef({ width: 0, height: 0 });
  const [error, setError] = useState<string | null>(null);

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
        pageSizeRef.current = {
          width: viewport.width / RENDER_SCALE,
          height: viewport.height / RENDER_SCALE,
        };
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
      className={`mx-auto w-fit rounded-lg border border-gray-200 bg-white p-4 shadow-sm ${onPageClick ? "cursor-crosshair" : ""}`}
      title={onPageClick ? "Click to add a field here" : undefined}
    >
      {error ? (
        <p className="max-w-md text-sm text-red-600">
          Page {pageNumber} failed to render: {error}
        </p>
      ) : (
        <canvas ref={canvasRef} className="max-w-full" onClick={handleClick} />
      )}
      <figcaption className="mt-2 text-center text-sm text-gray-500">
        Page {pageNumber} of {pageCount}
      </figcaption>
    </figure>
  );
}
