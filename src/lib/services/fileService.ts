import { join } from 'path'

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'invoices')
const IS_SERVERLESS = process.env.VERCEL === '1'

export async function saveUploadedFile(
  file: File,
  invoiceId: string,
  buffer?: Buffer,
): Promise<{ filePath: string; fileType: string }> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'pdf'

  if (IS_SERVERLESS) {
    return { filePath: '', fileType: ext }
  }

  const { writeFile, mkdir } = await import('fs/promises')
  const { existsSync } = await import('fs')

  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true })
  }

  const fileName = `${invoiceId}.${ext}`
  const filePath = join(UPLOAD_DIR, fileName)
  const data = buffer ?? Buffer.from(await file.arrayBuffer())
  await writeFile(filePath, data)

  return { filePath, fileType: ext }
}
