import { join } from 'path'

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'invoices')
const IS_SERVERLESS = process.env.VERCEL === '1'

export async function saveUploadedFile(
  file: File,
  invoiceId: string
): Promise<{ filePath: string; fileType: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'

  if (IS_SERVERLESS) {
    // File storage not available in serverless — tracked as pending (Option B: Vercel Blob)
    return { filePath: '', fileType: ext }
  }

  const { writeFile, mkdir } = await import('fs/promises')
  const { existsSync } = await import('fs')

  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }

  const fileName = `${invoiceId}.${ext}`
  const filePath = join(UPLOAD_DIR, fileName)
  const buffer = Buffer.from(await file.arrayBuffer())
  await writeFile(filePath, buffer)

  return { filePath, fileType: ext }
}
