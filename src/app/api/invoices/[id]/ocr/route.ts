import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireInvoiceAccess } from '@/lib/auth/helpers'
import { TERMINAL_STATUSES } from '@/lib/validations'
import { rateLimit } from '@/lib/rate-limit'
import { getFileBuffer } from '@/lib/services/fileService'
import { extractInvoiceFields } from '@/lib/services/geminiExtraction'

const MIME_MAP: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // This route REWRITES the invoice (dates, amounts, line items), so it needs
  // the same ownership check its read-only siblings do — it had only
  // requireAuth(), letting any signed-in user re-OCR any vendor's invoice.
  const { error, session, invoice } = await requireInvoiceAccess(id)
  if (error || !session || !invoice) return error

  const limit = rateLimit(`ocr:${session.user.id}`, 5, 60_000)
  if (limit) return limit

  // PATCH refuses to edit a settled invoice; re-running OCR would edit it
  // through the back door, so it stops at the same boundary.
  if ((TERMINAL_STATUSES as readonly string[]).includes(invoice.status)) {
    return NextResponse.json(
      { error: 'Invoice sudah final dan tidak bisa diproses ulang' },
      { status: 409 },
    )
  }

  const encoder = new TextEncoder()

  function emit(event: string, data: object) {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Ownership and status were already settled by requireInvoiceAccess
        // above, so only the file's presence is left to check here.
        if (!invoice.filePath) {
          controller.enqueue(emit('error', { message: 'Invoice or file not found' }))
          controller.close()
          return
        }

        controller.enqueue(emit('status', { step: 'started', message: 'Memulai OCR...' }))
        controller.enqueue(emit('status', { step: 'ocr', message: 'Membaca dokumen...' }))

        const buffer = await getFileBuffer(invoice.filePath)
        const mimeType = MIME_MAP[invoice.fileType ?? ''] ?? 'application/pdf'

        controller.enqueue(emit('status', { step: 'extracting', message: 'Mengekstrak data...' }))

        const extracted = await extractInvoiceFields(buffer, mimeType)

        // The extraction call classifies the document as a side effect, so
        // the primary document's type comes from here rather than a second
        // Gemini request. Matched by file_path — that's what this route read.
        await prisma.invoiceDocument.updateMany({
          where: { invoiceId: id, filePath: invoice.filePath },
          data: {
            type: extracted.document_type,
            classificationConfidence: extracted.classification_confidence,
          },
        })
        controller.enqueue(
          emit('document_type', {
            type: extracted.document_type,
            confidence: extracted.classification_confidence,
          }),
        )

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
        ] as const

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

        // Save extracted data to DB.
        //
        // `invoiceNumber` is deliberately NOT written here. It's the one field
        // the duplicate check in PATCH /api/invoices/[id] keys on, and that
        // check is the only place it runs — writing the extracted number here
        // would slip past it. Two things went wrong when this route did write
        // it (both seen in a real browser run, 2026-09-03):
        //   1. Abandoning the wizard after OCR parked a real invoice number on
        //      a live RECEIVED invoice, so re-uploading the same document was
        //      auto-rejected as a duplicate of the user's own abandoned draft.
        //   2. A second OCR of the same document tripped the partial unique
        //      index, and this route's catch turned the whole extraction into
        //      an SSE error — silently discarding every other extracted field.
        // The client still receives the number via the `field` events above and
        // submits it through PATCH, which duplicate-checks it properly.
        await prisma.invoice.update({
          where: { id },
          data: {
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
            data: extracted.line_items.map((item, i) => ({
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
