import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

type PageThumbnailProps = {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  fieldCount: number;
  selected: boolean;
  onSelect: (page: number) => void;
};

/** One page thumbnail for the Setup rail, rendered at low
 * resolution (scale 0.2) and only once it scrolls into view, so a
 * long document does not render every page up front. */
export function PageThumbnail({
  pdf,
  pageNumber,
  fieldCount,
  selected,
  onSelect,
}: PageThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let renderTask: ReturnType<
      Awaited<ReturnType<typeof pdf.getPage>>["render"]
    > | null = null;
    async function render() {
      try {
        const page = await pdf.getPage(pageNumber);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 0.2 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        // pdf.js v6 wants the canvas element itself.
        renderTask = page.render({ canvas, viewport });
        await renderTask.promise;
      } catch {
        // A failed thumbnail leaves the grey placeholder; the
        // pager still works.
      }
    }
    void render();
    return () => {
      cancelled = true;
      void renderTask?.cancel();
    };
  }, [pdf, pageNumber, visible]);

  return (
    <button
      ref={wrapRef}
      type="button"
      onClick={() => onSelect(pageNumber)}
      aria-label={`Page ${pageNumber}, ${fieldCount} fields`}
      aria-current={selected ? "true" : undefined}
      className={`w-full rounded-md border bg-white p-1.5 text-center ${
        selected
          ? "border-blue-600 ring-1 ring-blue-600"
          : "border-gray-200 hover:border-gray-400"
      }`}
    >
      <span className="block min-h-16 w-full overflow-hidden rounded-sm bg-gray-100">
        <canvas ref={canvasRef} className="h-auto w-full" />
      </span>
      <span className="mt-1 block text-xs text-gray-600">
        {pageNumber} · {fieldCount}{" "}
        {fieldCount === 1 ? "field" : "fields"}
      </span>
    </button>
  );
}
