import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireInvoiceAccess } from '@/lib/auth/helpers'
import { TERMINAL_STATUSES } from '@/lib/validations'
import { rateLimit } from '@/lib/rate-limit'
import { getFileBuffer, mimeTypeFor } from '@/lib/services/fileService'
import { extractInvoiceFields, buildOcrUpdate } from '@/lib/services/geminiExtraction'
import { matchCompany } from '@/lib/companyMatch'

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

  // Set when the user picks which document is the invoice on the confirmation
  // step — the re-run path below.
  const requestedDocumentId = req.nextUrl.searchParams.get('documentId')

  const encoder = new TextEncoder()

  function emit(event: string, data: object) {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Ownership and status were already settled by requireInvoiceAccess
        // above, so only document selection is left to decide here.
        //
        // Selection order: a type a human set wins over any AI guess
        // (classificationConfidence is nulled when a person assigns the type,
        // so nulls sort first), then the most confident AI label, then upload
        // order as a stable tiebreak.
        const documents = await prisma.invoiceDocument.findMany({
          where: { invoiceId: id },
          orderBy: [
            { classificationConfidence: { sort: 'desc', nulls: 'first' } },
            { createdAt: 'asc' },
          ],
          select: {
            id: true,
            type: true,
            filePath: true,
            fileType: true,
            originalName: true,
            classificationConfidence: true,
          },
        })

        if (documents.length === 0) {
          controller.enqueue(emit('error', { message: 'Invoice or file not found' }))
          controller.close()
          return
        }

        // Every file was classified at upload time. Extraction reads exactly
        // one of them, and which one is not a free choice: pulling the bill-to
        // company and the PO out of a faktur pajak or a BAST produces
        // confidently wrong data, which is worse than none.
        //
        // So there is deliberately no "just use the first file" fallback. Only
        // a document actually classified INVOICE qualifies, and
        // normalizeClassification has already refused to apply that label below
        // CLASSIFICATION_CONFIDENCE_FLOOR — so "is INVOICE" already means
        // "confident enough". When nothing qualifies, the stream reports that
        // and stops; the confirmation step asks the user which document is the
        // invoice and re-runs this route with ?documentId=.
        const document = requestedDocumentId
          ? documents.find((d) => d.id === requestedDocumentId)
          : documents.find((d) => d.type === 'INVOICE')

        if (requestedDocumentId && !document) {
          controller.enqueue(emit('error', { message: 'Document not found on this invoice' }))
          controller.close()
          return
        }

        if (!document) {
          controller.enqueue(
            emit('needs_invoice_selection', {
              message: 'Dokumen invoice belum teridentifikasi',
              documents: documents.map((d) => ({
                id: d.id,
                originalName: d.originalName,
                type: d.type,
                classificationConfidence: d.classificationConfidence,
              })),
            }),
          )
          controller.close()
          return
        }

        controller.enqueue(emit('status', { step: 'started', message: 'Memulai OCR...' }))
        controller.enqueue(
          emit('driving_document', {
            documentId: document.id,
            originalName: document.originalName,
            type: document.type,
            classificationConfidence: document.classificationConfidence,
          }),
        )
        controller.enqueue(emit('status', { step: 'ocr', message: 'Membaca dokumen...' }))

        const buffer = await getFileBuffer(document.filePath)
        const mimeType = mimeTypeFor(document.fileType, 'application/pdf')

        // The legacy single-file columns follow whichever document extraction
        // actually read — three read paths still go through them (the /file
        // endpoint, the detail page's fallback preview, and this route's own
        // pre-multi-file history).
        if (invoice.filePath !== document.filePath) {
          await prisma.invoice.update({
            where: { id },
            data: { filePath: document.filePath, fileType: document.fileType },
          })
        }

        controller.enqueue(emit('status', { step: 'extracting', message: 'Mengekstrak data...' }))

        const extracted = await extractInvoiceFields(buffer, mimeType)

        // The extraction call classifies as a side effect, which refines the
        // cheap classify-only label the upload made. It must never overwrite a
        // type a human assigned: a user who marked this file as the invoice
        // would otherwise see it demoted back to OTHER, and the next run would
        // again find no invoice document. A null confidence is exactly the
        // marker for "a person set this".
        if (document.classificationConfidence !== null) {
          await prisma.invoiceDocument.update({
            where: { id: document.id },
            data: {
              type: extracted.document_type,
              classificationConfidence: extracted.classification_confidence,
            },
          })
          controller.enqueue(
            emit('document_type', {
              documentId: document.id,
              type: extracted.document_type,
              confidence: extracted.classification_confidence,
            }),
          )
        }

        // Bill-to resolution. The wizard no longer asks which company an
        // invoice is for, so it is matched here against the active companies
        // and reported with the raw strings alongside the verdict — the
        // confirmation step shows what was read versus what it matched, and
        // lets the user correct either outcome. Inactive companies are excluded
        // for the same reason the old dropdown never listed them.
        const companies = await prisma.company.findMany({
          where: { isActive: true },
          select: { id: true, name: true, npwp: true },
        })
        const companyMatch = matchCompany(
          { name: extracted.company_name?.value, npwp: extracted.company_npwp?.value },
          companies,
        )
        controller.enqueue(
          emit('company', {
            ...companyMatch,
            extractedName: extracted.company_name?.value ?? null,
            extractedNpwp: extracted.company_npwp?.value ?? null,
            confidence: extracted.company_name?.confidence ?? 0,
          }),
        )

        // Emit each field one by one for the animated reveal
        const fieldOrder = [
          { key: 'vendor_name', label: 'Nama Vendor' },
          { key: 'invoice_number', label: 'Nomor Invoice' },
          { key: 'po_number', label: 'Nomor PO' },
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
        //
        // `poNumber` and `companyId` are held back for the same reason: both
        // are gated by validateReadyToGoLive when the draft goes live, and
        // writing them straight from OCR would satisfy that gate with data no
        // human has confirmed. They travel to the client as events and come
        // back through PATCH.
        //
        // Everything below goes through the same rules PATCH enforces. This
        // write used to bypass zod entirely: amounts went in via bare
        // parseFloat (so '12.500.000' became 12.5, 'N/A' became NaN and made
        // the whole update throw, and a negative was stored as-is), currency
        // took whatever string the model produced, and a missed extraction
        // NULLed a due date that was already correct.
        const extractedUpdate = buildOcrUpdate(extracted, invoice)
        await prisma.invoice.update({ where: { id }, data: extractedUpdate.data })

        if (extractedUpdate.rejected.length > 0) {
          controller.enqueue(emit('warning', { fields: extractedUpdate.rejected }))
        }

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
