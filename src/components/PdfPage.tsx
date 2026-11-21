import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfPageProps = {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  pageCount: number;
};

/** Renders one PDF page to a canvas, with its page number below it. */
export function PdfPage({ pdf, pageNumber, pageCount }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
        const viewport = page.getViewport({ scale: 1.5 });
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

  return (
    <figure className="mx-auto w-fit rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      {error ? (
        <p className="max-w-md text-sm text-red-600">
          Page {pageNumber} failed to render: {error}
        </p>
      ) : (
        <canvas ref={canvasRef} className="max-w-full" />
      )}
      <figcaption className="mt-2 text-center text-sm text-gray-500">
        Page {pageNumber} of {pageCount}
      </figcaption>
    </figure>
  );
}
