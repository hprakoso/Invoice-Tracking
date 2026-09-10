/**
 * Every limit and accepted-format rule for invoice document uploads, in one
 * place. These were previously inline in the upload route only; the wizard now
 * submits several files at once and has to enforce and display the same rules
 * before sending, so they live here rather than being restated on both sides.
 *
 * No `next/server` import — this module is imported by client components, the
 * same reason invoiceStatus.ts exists separately from validations.ts.
 */

/**
 * Documents one invoice submission may carry. An initial technical limit
 * rather than a business rule: a real submission is an invoice plus a faktur
 * pajak, a BAST and a handful of supporting files, and every file costs one
 * Gemini classification call. Raise it here — nothing else hardcodes a count.
 */
export const MAX_DOCUMENTS_PER_INVOICE = 10

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

export const MAX_FILE_SIZE_LABEL = '10MB'

export const ACCEPTED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
] as const

export const ACCEPTED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'] as const

/** react-dropzone's `accept` map — mime type to the extensions it covers. */
export const DROPZONE_ACCEPT: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
}

/**
 * Leading bytes each accepted extension must actually start with, so a
 * renamed executable cannot pass as a PDF by its declared mime type alone.
 */
export const MAGIC_SIGNATURES: Record<string, string[]> = {
  pdf: ['25504446'],
  jpg: ['FFD8FF'],
  jpeg: ['FFD8FF'],
  png: ['89504E470D0A1A0A'],
}

/**
 * Verifies a file's real leading bytes against its extension.
 * `buffer` only needs to cover the first 8 bytes.
 */
export function hasValidSignature(fileName: string, buffer: Buffer): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const expected = MAGIC_SIGNATURES[ext]
  if (!expected) return false
  const signature = buffer.subarray(0, 8).toString('hex').toUpperCase()
  return expected.some((sig) => signature.startsWith(sig))
}
