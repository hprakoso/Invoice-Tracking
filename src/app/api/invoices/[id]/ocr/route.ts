import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth/helpers'
import { rateLimit } from '@/lib/rate-limit'

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:8000'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, session } = await requireAuth()
  if (error || !session) return error

  const limit = rateLimit(`ocr:${session.user.id}`, 5, 60_000)
  if (limit) return limit

  const { id } = await params

  const encoder = new TextEncoder()

  function emit(event: string, data: object) {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Fetch invoice
        const invoice = await prisma.invoice.findUnique({ where: { id } })
        if (!invoice || !invoice.filePath) {
          controller.enqueue(emit('error', { message: 'Invoice or file not found' }))
          controller.close()
          return
        }

        controller.enqueue(emit('status', { step: 'started', message: 'Memulai OCR...' }))

        // Call AI service
        controller.enqueue(emit('status', { step: 'ocr', message: 'Membaca dokumen...' }))

        const aiRes = await fetch(`${AI_SERVICE_URL}/ocr/extract`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_path: invoice.filePath, invoice_id: id }),
          signal: AbortSignal.timeout(60000),
        })

        if (!aiRes.ok) {
          throw new Error(`AI service error: ${aiRes.status}`)
        }

        const extracted = await aiRes.json()

        controller.enqueue(emit('status', { step: 'extracting', message: 'Mengekstrak data...' }))

        // Emit each field one by one for the animated reveal
        const fieldOrder = [
          { key: 'vendor_name', label: 'Nama Vendor' },
          { key: 'invoice_number', label: 'Nomor Invoice' },
          { key: 'invoice_date', label: 'Tanggal Invoice' },
          { key: 'due_date', label: 'Jatuh Tempo' },
          { key: 'currency', label: 'Mata Uang' },
          { key: 'subtotal', label: 'Subtotal' },
          { key: 'tax_amount', label: 'PPN' },
          { key: 'total_amount', label: 'Total' },
        ]

        for (const field of fieldOrder) {
          const fieldData = extracted[field.key]
          controller.enqueue(
            emit('field', {
              key: field.key,
              label: field.label,
              value: fieldData?.value ?? null,
              confidence: fieldData?.confidence ?? 0,
            })
          )
          // Small delay between fields for animation effect
          await new Promise(resolve => setTimeout(resolve, 300))
        }

        // Emit line items
        if (extracted.line_items?.length > 0) {
          controller.enqueue(emit('line_items', { items: extracted.line_items }))
        }

        // Save extracted data to DB
        await prisma.invoice.update({
          where: { id },
          data: {
            invoiceNumber: extracted.invoice_number?.value ?? invoice.invoiceNumber,
            invoiceDate: extracted.invoice_date?.value ? new Date(extracted.invoice_date.value) : null,
            dueDate: extracted.due_date?.value ? new Date(extracted.due_date.value) : null,
            currency: extracted.currency?.value ?? 'IDR',
            subtotal: extracted.subtotal?.value ? parseFloat(extracted.subtotal.value) : null,
            taxAmount: extracted.tax_amount?.value ? parseFloat(extracted.tax_amount.value) : null,
            totalAmount: extracted.total_amount?.value
              ? parseFloat(extracted.total_amount.value)
              : invoice.totalAmount,
            ocrConfidence: extracted.overall_confidence ?? 0,
          },
        })

        // Update line items if extracted
        if (extracted.line_items?.length > 0) {
          await prisma.invoiceItem.deleteMany({ where: { invoiceId: id } })
          await prisma.invoiceItem.createMany({
            data: extracted.line_items.map((item: { description: string; quantity?: number; unit_price?: number; total?: number }, i: number) => ({
              invoiceId: id,
              description: item.description,
              quantity: item.quantity ?? null,
              unitPrice: item.unit_price ?? null,
              total: item.total ?? 0,
              sortOrder: i,
            })),
          })
        }

        controller.enqueue(
          emit('done', {
            overallConfidence: extracted.overall_confidence,
            message: 'Ekstraksi selesai!',
          })
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        controller.enqueue(emit('error', { message }))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
