import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'invoices')

export async function saveUploadedFile(
  file: File,
  invoiceId: string
): Promise<{ filePath: string; fileType: string }> {
  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'
  const fileName = `${invoiceId}.${ext}`
  const filePath = join(UPLOAD_DIR, fileName)

  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(filePath, buffer)

  return { filePath, fileType: ext }
}
