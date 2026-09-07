import { GoogleGenAI, Type } from '@google/genai'
import { parseAmountID } from '@/lib/format'

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'

const FIELD_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    value: { type: Type.STRING, nullable: true },
    confidence: { type: Type.NUMBER, description: 'Extraction confidence, 0-100' },
  },
  required: ['confidence'],
}

const LINE_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    description: { type: Type.STRING },
    quantity: { type: Type.NUMBER, nullable: true },
    unit_price: { type: Type.NUMBER, nullable: true },
    total: { type: Type.NUMBER },
  },
  required: ['description', 'total'],
}

// Shared by the full extraction call and the standalone classifier below.
// Kept identical in both so a document classified one way by the cheap call
// can't be classified differently by the expensive one.
const DOCUMENT_TYPES = ['INVOICE', 'TAX_INVOICE', 'BAST', 'OTHER'] as const
export type DocumentTypeKey = (typeof DOCUMENT_TYPES)[number]

const DOCUMENT_TYPE_GUIDE = `Document types:
- INVOICE: a commercial invoice / tagihan / faktur billing for goods or services. Has an invoice number, amounts, and payment terms.
- TAX_INVOICE: an Indonesian Faktur Pajak — a government tax document. Identified by a "Faktur Pajak" heading, a 16-digit Nomor Seri Faktur Pajak (NSFP), and DJP/Direktorat Jenderal Pajak references. NOT the same as a commercial invoice even though it also lists amounts and PPN.
- BAST: Berita Acara Serah Terima — a handover/acceptance record confirming goods or services were delivered and received. Has signature blocks for both parties and usually no payment amount.
- OTHER: anything else (purchase order, delivery note, bank details, contract, correspondence, or a document you cannot confidently place).`

const CLASSIFICATION_RULE = `Set document_type to the best match, and classification_confidence to your certainty 0-100. If two types are plausible or the document is unclear, prefer OTHER with a low confidence rather than guessing a specific type — a wrong specific label is worse than an honest OTHER.`

const EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    document_type: { type: Type.STRING, enum: [...DOCUMENT_TYPES] },
    classification_confidence: { type: Type.NUMBER, description: 'Document-type certainty, 0-100' },
    vendor_name: FIELD_SCHEMA,
    invoice_number: FIELD_SCHEMA,
    invoice_date: FIELD_SCHEMA,
    due_date: FIELD_SCHEMA,
    currency: FIELD_SCHEMA,
    subtotal: FIELD_SCHEMA,
    tax_amount: FIELD_SCHEMA,
    total_amount: FIELD_SCHEMA,
    line_items: { type: Type.ARRAY, items: LINE_ITEM_SCHEMA },
  },
  required: [
    'document_type', 'classification_confidence',
    'vendor_name', 'invoice_number', 'invoice_date', 'due_date',
    'currency', 'subtotal', 'tax_amount', 'total_amount', 'line_items',
  ],
}

const CLASSIFICATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    document_type: { type: Type.STRING, enum: [...DOCUMENT_TYPES] },
    classification_confidence: { type: Type.NUMBER, description: 'Document-type certainty, 0-100' },
  },
  required: ['document_type', 'classification_confidence'],
}

const PROMPT = `You are an expert document processor for an invoice system. Read the attached document directly (it may be a scanned image or a PDF), in Indonesian, English, or mixed language.

First classify it, then extract the invoice fields defined by the response schema.

${DOCUMENT_TYPE_GUIDE}

${CLASSIFICATION_RULE}

For Indonesian invoices: "Tanggal" = invoice date, "Jatuh Tempo" = due date, "Subtotal" = subtotal, "PPN" = tax (usually 11%), "Total"/"Total Bayar" = total amount.

Rules:
- Dates must be formatted YYYY-MM-DD, or null if not present/legible.
- All amounts are plain numeric strings with no currency symbol or thousand separators (Indonesian invoices often write 1.000.000 for one million — strip the dots).
- confidence is your own certainty in the extracted value, 0-100. Use a low confidence (not null) for values you had to infer, and set value to null with confidence near 0 for fields genuinely absent from the document.
- line_items should list every billable line on the invoice; if none are itemized, return an empty array.
- If the document is not an INVOICE, still fill in whatever fields it genuinely contains and set the rest to null with confidence 0 — do not invent invoice data for a document that has none.`

const CLASSIFY_PROMPT = `Identify what kind of document this is. Read it directly (it may be a scanned image or a PDF), in Indonesian, English, or mixed language.

${DOCUMENT_TYPE_GUIDE}

${CLASSIFICATION_RULE}`

export interface ExtractedField {
  value: string | null
  confidence: number
}

export interface ExtractionResult {
  document_type: DocumentTypeKey
  classification_confidence: number
  vendor_name: ExtractedField
  invoice_number: ExtractedField
  invoice_date: ExtractedField
  due_date: ExtractedField
  currency: ExtractedField
  subtotal: ExtractedField
  tax_amount: ExtractedField
  total_amount: ExtractedField
  line_items: { description: string; quantity: number | null; unit_price: number | null; total: number }[]
  overall_confidence: number
}

/** A date the model returned is only accepted if it's parseable and plausible. */
function parseExtractedDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const parsed = new Date(raw)
  if (isNaN(parsed.getTime())) return null
  const year = parsed.getUTCFullYear()
  // Guards year misreads ('0202', '2205'), which otherwise park an invoice in
  // the wrong aging bucket permanently and never stop generating reminders.
  if (year < 2000 || year > new Date().getUTCFullYear() + 10) return null
  return parsed
}

const AMOUNT_COLUMNS = [
  ['subtotal', 'subtotal'],
  ['tax_amount', 'taxAmount'],
  ['total_amount', 'totalAmount'],
] as const

export interface OcrUpdate {
  data: {
    ocrConfidence: number
    invoiceDate?: Date
    dueDate?: Date
    currency?: string
    subtotal?: number
    taxAmount?: number
    totalAmount?: number
  }
  /** Extraction keys the model produced but that failed validation. */
  rejected: string[]
}

/**
 * Turn a raw extraction into a validated Prisma update.
 *
 * The OCR route used to write the model's output straight through — no zod, no
 * checks — which is how impossible data reached the database:
 *   - amounts via bare `parseFloat`, so '12.500.000' stored as 12.5, a
 *     '-500000' stored negative, and 'N/A' produced NaN, which made the whole
 *     update throw and silently discarded *every* extracted field;
 *   - `currency` was whatever string came back ('US$', 'Rupiah'), and PATCH has
 *     no `currency` branch, so a bad value could never be corrected via the API;
 *   - a due date earlier than the invoice date was written unchallenged — the
 *     case that produced invoices the dashboard counted as overdue while the
 *     detail view showed nothing sensible;
 *   - a missed extraction NULLed a due date that was already correct.
 *
 * A field that fails validation is **left at its current value** rather than
 * nulled, and reported in `rejected` so the caller can tell the user which
 * fields need typing in by hand.
 */
export function buildOcrUpdate(
  extracted: ExtractionResult,
  current: { invoiceDate: Date | null; dueDate: Date | null },
): OcrUpdate {
  const rejected: string[] = []
  const data: OcrUpdate['data'] = { ocrConfidence: extracted.overall_confidence ?? 0 }

  const invoiceDate = parseExtractedDate(extracted.invoice_date?.value)
  if (invoiceDate) data.invoiceDate = invoiceDate
  else if (extracted.invoice_date?.value) rejected.push('invoice_date')

  const dueDate = parseExtractedDate(extracted.due_date?.value)
  const effectiveInvoiceDate = invoiceDate ?? current.invoiceDate
  if (dueDate && effectiveInvoiceDate && dueDate < effectiveInvoiceDate) {
    // An invoice cannot fall due before it was issued: the pair is a misread
    // (commonly the two dates swapped), so the due date is dropped rather than
    // stored as an impossible combination.
    rejected.push('due_date')
  } else if (dueDate) {
    data.dueDate = dueDate
  } else if (extracted.due_date?.value) {
    rejected.push('due_date')
  }

  const currency = extracted.currency?.value?.trim().toUpperCase()
  if (currency && /^[A-Z]{3}$/.test(currency)) data.currency = currency
  else if (currency) rejected.push('currency')

  for (const [key, column] of AMOUNT_COLUMNS) {
    const raw = extracted[key]?.value
    const value = parseAmountID(raw)
    if (value === null || value < 0) {
      if (raw) rejected.push(key)
      continue
    }
    data[column] = value
  }

  return { data, rejected }
}

// Matches ai-service's old overall_confidence formula: average confidence of the
// core fields that were actually extracted (currency excluded — it's rarely ambiguous).
const CORE_FIELDS = [
  'vendor_name', 'invoice_number', 'invoice_date', 'due_date', 'total_amount', 'tax_amount', 'subtotal',
] as const

export async function extractInvoiceFields(buffer: Buffer, mimeType: string): Promise<ExtractionResult> {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) throw new Error('GOOGLE_API_KEY is not configured')

  const ai = new GoogleGenAI({ apiKey })
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: PROMPT }, { inlineData: { mimeType, data: buffer.toString('base64') } }],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: EXTRACTION_SCHEMA,
    },
  })

  const text = response.text
  if (!text) throw new Error('Gemini returned an empty extraction response')

  const parsed = JSON.parse(text) as Omit<ExtractionResult, 'overall_confidence'>

  const confidences = CORE_FIELDS
    .map((key) => parsed[key])
    .filter((field) => field?.value !== null && field?.value !== undefined)
    .map((field) => field.confidence)
  const overall = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0

  const { type, confidence } = normalizeClassification(parsed.document_type, parsed.classification_confidence)

  return {
    ...parsed,
    document_type: type,
    classification_confidence: confidence,
    overall_confidence: Math.round(overall * 10) / 10,
  }
}

// Below this the model's own label isn't trusted enough to stand as a
// specific type — it falls back to OTHER so a wrong specific label never
// silently sticks. The real guarantee against misclassification is the
// manual override in the UI, not this threshold; 70 matches the
// medium-confidence cutoff ConfidenceBar already uses elsewhere.
export const CLASSIFICATION_CONFIDENCE_FLOOR = 70

export function normalizeClassification(
  rawType: string | null | undefined,
  rawConfidence: number | null | undefined,
): { type: DocumentTypeKey; confidence: number } {
  const confidence = Math.max(0, Math.min(100, Number(rawConfidence) || 0))
  const known = (DOCUMENT_TYPES as readonly string[]).includes(rawType ?? '')
  if (!known || confidence < CLASSIFICATION_CONFIDENCE_FLOOR) {
    return { type: 'OTHER', confidence }
  }
  return { type: rawType as DocumentTypeKey, confidence }
}

// Cheap classify-only call for the supporting documents uploaded alongside
// the invoice. Running the full extraction schema against a BAST would spend
// tokens extracting invoice fields that aren't there; this asks one question.
export async function classifyDocument(
  buffer: Buffer,
  mimeType: string,
): Promise<{ type: DocumentTypeKey; confidence: number }> {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) throw new Error('GOOGLE_API_KEY is not configured')

  const ai = new GoogleGenAI({ apiKey })
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ text: CLASSIFY_PROMPT }, { inlineData: { mimeType, data: buffer.toString('base64') } }],
      },
    ],
    config: { responseMimeType: 'application/json', responseSchema: CLASSIFICATION_SCHEMA },
  })

  const text = response.text
  if (!text) throw new Error('Gemini returned an empty classification response')

  const parsed = JSON.parse(text) as { document_type?: string; classification_confidence?: number }
  return normalizeClassification(parsed.document_type, parsed.classification_confidence)
}
