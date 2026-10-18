/**
 * Text from a PDF with poppler's `pdftotext` (the GitHub Actions loaders install
 * poppler-utils; an Edge Function can't run it, so this module is Node only and is
 * exported from `@civic/sync/loaders`, never from the package's main entry).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface PdfTextOptions {
  /** Keep the page layout (`-layout`): columns and indentation, as the agenda parsers expect. */
  layout?: boolean;
}

export type PdfText = (pdf: Uint8Array, options?: PdfTextOptions) => string;

export const pdfText: PdfText = (pdf, options = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'commonhall-pdf-'));
  try {
    const file = join(dir, 'document.pdf');
    writeFileSync(file, pdf);
    const args = options.layout ? ['-layout', file, '-'] : [file, '-'];
    return execFileSync('pdftotext', args, { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
