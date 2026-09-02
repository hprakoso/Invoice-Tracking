import { join } from 'path'
import { createClient } from '@supabase/supabase-js'

const BUCKET = 'invoices'
const UPLOAD_DIR = join(process.cwd(), 'uploads', 'invoices')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

// Falls back to local disk when Supabase isn't configured (e.g. local dev without
// a Supabase project set up yet). Local disk doesn't survive Vercel's serverless
// filesystem, so a real deployment needs SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY set.
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null

// filePath is "{invoiceId}/{documentId}.{ext}" — every component is
// server-derived (both ids are uuids we generated), never taken from user
// input, so there's no path-traversal surface to defend against on read.
//
// Pre-2026-09-03 rows use the older flat "{invoiceId}.{ext}" key, which is
// still read back correctly: getFileBuffer() takes the stored path verbatim
// rather than re-deriving it, so both layouts coexist and the backfilled
// legacy documents needed no storage migration.
export async function saveUploadedFile(
  file: File,
  invoiceId: string,
  documentId: string,
  buffer: Buffer,
): Promise<{ filePath: string; fileType: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
  const objectPath = `${invoiceId}/${documentId}.${ext}`

  if (supabase) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, buffer, { contentType: file.type, upsert: true })
    if (error) throw new Error(`Supabase upload failed: ${error.message}`)
    return { filePath: objectPath, fileType: ext }
  }

  const { writeFile, mkdir } = await import('fs/promises')
  const { dirname } = await import('path')
  const target = join(UPLOAD_DIR, objectPath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, buffer)
  return { filePath: objectPath, fileType: ext }
}

export async function getFileBuffer(filePath: string): Promise<Buffer> {
  if (supabase) {
    const { data, error } = await supabase.storage.from(BUCKET).download(filePath)
    if (error || !data) throw new Error(`Supabase download failed: ${error?.message ?? 'not found'}`)
    return Buffer.from(await data.arrayBuffer())
  }

  const { readFile } = await import('fs/promises')
  return readFile(join(UPLOAD_DIR, filePath))
}
