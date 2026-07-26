import { GoogleGenAI, Type } from '@google/genai'

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

const EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
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
    'vendor_name', 'invoice_number', 'invoice_date', 'due_date',
    'currency', 'subtotal', 'tax_amount', 'total_amount', 'line_items',
  ],
}

const PROMPT = `You are an expert invoice data extractor. The attached document is an invoice, which may be in Indonesian, English, or mixed language. Read it directly (it may be a scanned image or a PDF) and extract the fields defined by the response schema.

For Indonesian invoices: "Tanggal" = invoice date, "Jatuh Tempo" = due date, "Subtotal" = subtotal, "PPN" = tax (usually 11%), "Total"/"Total Bayar" = total amount.

Rules:
- Dates must be formatted YYYY-MM-DD, or null if not present/legible.
- All amounts are plain numeric strings with no currency symbol or thousand separators (Indonesian invoices often write 1.000.000 for one million — strip the dots).
- confidence is your own certainty in the extracted value, 0-100. Use a low confidence (not null) for values you had to infer, and set value to null with confidence near 0 for fields genuinely absent from the document.
- line_items should list every billable line on the invoice; if none are itemized, return an empty array.`

export interface ExtractedField {
  value: string | null
  confidence: number
}

export interface ExtractionResult {
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

  return { ...parsed, overall_confidence: Math.round(overall * 10) / 10 }
}
