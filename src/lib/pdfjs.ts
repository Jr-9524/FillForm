import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// pdf.js renders pages in a Web Worker. Vite bundles the worker file
// and gives us its URL with the `?url` import above.
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export default pdfjsLib;
