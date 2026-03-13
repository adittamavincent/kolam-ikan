declare module "pdfjs-dist/legacy/build/pdf" {
  export interface PDFPageLike {
    getViewport(options: { scale: number }): { width: number; height: number };
    render(options: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
    }): { promise: Promise<void> };
  }

  export interface PDFMetadataInfo {
    Title?: string;
    Author?: string;
    CreationDate?: string;
  }

  export interface PDFDocumentLike {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageLike>;
    getMetadata?: () => Promise<{ info: PDFMetadataInfo }>;
    destroy?: () => Promise<void>;
  }

  export interface PDFJSLibrary {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument(source: { data?: ArrayBuffer | Uint8Array } | { url?: string }): { promise: Promise<PDFDocumentLike> };
  }

  const pdfjsLib: PDFJSLibrary;
  export = pdfjsLib;
}

declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  const pdfjsLib: typeof import("pdfjs-dist/legacy/build/pdf");
  export = pdfjsLib;
}

declare module "pdfjs-dist" {
  export interface PDFPageLike {
    getViewport(options: { scale: number }): { width: number; height: number };
    render(options: {
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
    }): { promise: Promise<void> };
  }

  export interface PDFMetadataInfo {
    Title?: string;
    Author?: string;
    CreationDate?: string;
  }

  export interface PDFDocumentLike {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageLike>;
    getMetadata?: () => Promise<{ info: PDFMetadataInfo }>;
    destroy?: () => Promise<void>;
  }

  export interface PDFJSLibrary {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument(source: { data?: ArrayBuffer } | { url?: string }): { promise: Promise<PDFDocumentLike> };
  }

  const pdfjsLib: PDFJSLibrary;
  export = pdfjsLib;
}
