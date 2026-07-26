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

// filePath is always just "{invoiceId}.{ext}" — server-derived, never taken from
// user input — so there's no path-traversal surface to defend against on read.
export async function saveUploadedFile(
  file: File,
  invoiceId: string,
  buffer: Buffer,
): Promise<{ filePath: string; fileType: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
  const objectPath = `${invoiceId}.${ext}`

  if (supabase) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(objectPath, buffer, { contentType: file.type, upsert: true })
    if (error) throw new Error(`Supabase upload failed: ${error.message}`)
    return { filePath: objectPath, fileType: ext }
  }

  const { writeFile, mkdir } = await import('fs/promises')
  const { existsSync } = await import('fs')
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }
  await writeFile(join(UPLOAD_DIR, objectPath), buffer)
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
