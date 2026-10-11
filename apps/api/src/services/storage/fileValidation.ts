import { fileTypeFromBuffer } from 'file-type';
import { validationError } from '../../lib/errors';

/** Types that cannot be sniffed from magic bytes; validated as text instead. */
const TEXT_TYPES = new Set(['text/plain', 'text/csv']);
const OOXML = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function looksLikeText(buf: Buffer) {
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) return false;
  return !sample.toString('utf8').includes('�');
}

/** Expected content types for common extensions; a mismatch means the file is disguised. */
const EXTENSION_TYPES: Record<string, string[]> = {
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  pdf: ['application/pdf'],
  txt: ['text/plain'],
  log: ['text/plain'],
  md: ['text/plain'],
  csv: ['text/csv', 'text/plain'],
  zip: ['application/zip'],
  docx: [...OOXML].slice(0, 1),
  xlsx: [...OOXML].slice(1, 2),
};

export function sanitizeFilename(name: string) {
  const base = name.replace(/[/\\]/g, '_').replace(/[\x00-\x1f\x7f"<>|:*?]/g, '').trim();
  return (base || 'file').slice(0, 200);
}

/**
 * Determines the real content type from the file's bytes and checks it against the allow-list.
 * The client-declared MIME type is never trusted.
 */
export async function detectAndValidate(buf: Buffer, originalName: string, allowed: string[]): Promise<string> {
  const detected = await fileTypeFromBuffer(buf);
  let mime: string | undefined = detected?.mime;
  if (!detected) {
    if (looksLikeText(buf)) mime = originalName.toLowerCase().endsWith('.csv') ? 'text/csv' : 'text/plain';
  } else if (detected.mime === 'application/zip' && /\.(docx|xlsx)$/i.test(originalName)) {
    // OOXML documents are zip containers; accept the specific type when the extension matches
    mime = originalName.toLowerCase().endsWith('.docx') ? [...OOXML][0] : [...OOXML][1];
  }
  const ext = originalName.includes('.') ? originalName.split('.').pop()!.toLowerCase() : '';
  const expected = EXTENSION_TYPES[ext];
  if (mime && expected && !expected.includes(mime)) {
    throw validationError(`File content does not match its extension: ${originalName}`);
  }
  if (!mime || !allowed.includes(mime)) {
    throw validationError(`File type not allowed: ${originalName}`, { allowed });
  }
  if (TEXT_TYPES.has(mime) && !looksLikeText(buf)) throw validationError(`File content does not match its type: ${originalName}`);
  return mime;
}
