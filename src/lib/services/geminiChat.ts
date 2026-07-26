import {
  GoogleGenAI,
  createUserContent,
  createPartFromFunctionResponse,
  type Content,
  type FunctionDeclaration,
} from '@google/genai'
import { prisma } from '@/lib/db/prisma'
import type { Prisma, InvoiceStatus } from '@prisma/client'

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
const STATUS_VALUES: InvoiceStatus[] = ['SUBMITTED', 'PAID', 'CANCELLED', 'REJECTED', 'VOID', 'REVISION']

const queryInvoicesDeclaration: FunctionDeclaration = {
  name: 'query_invoices',
  description:
    'Search the invoices database with optional filters. Returns up to `limit` matching invoices plus the total count and total amount across ALL matches (not just the returned list), so aggregate questions (totals, counts) can be answered accurately even when there are more matches than the list shows. Call this whenever the question depends on real invoice data — never estimate or invent numbers.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: STATUS_VALUES,
        description: 'Filter to an exact invoice status. Omit to include every status.',
      },
      vendorName: { type: 'string', description: 'Partial, case-insensitive match on the vendor (sender) name.' },
      companyName: { type: 'string', description: 'Partial, case-insensitive match on the bill-to company name.' },
      overdueOnly: {
        type: 'boolean',
        description: 'If true, only invoices whose dueDate has passed and are still unresolved (status SUBMITTED or REVISION).',
      },
      dueBefore: { type: 'string', description: 'ISO date YYYY-MM-DD. Only invoices due on or before this date.' },
      dueAfter: { type: 'string', description: 'ISO date YYYY-MM-DD. Only invoices due on or after this date.' },
      limit: { type: 'number', description: 'Max invoices in the returned list. Default 20, max 50.' },
    },
  },
}

interface QueryInvoicesArgs {
  status?: InvoiceStatus
  vendorName?: string
  companyName?: string
  overdueOnly?: boolean
  dueBefore?: string
  dueAfter?: string
  limit?: number
}

async function executeQueryInvoices(args: QueryInvoicesArgs) {
  const where: Prisma.InvoiceWhereInput = {}

  if (args.status && STATUS_VALUES.includes(args.status)) where.status = args.status
  if (args.vendorName) where.vendor = { name: { contains: args.vendorName, mode: 'insensitive' } }
  if (args.companyName) where.company = { name: { contains: args.companyName, mode: 'insensitive' } }
  if (args.overdueOnly) {
    where.status = { in: ['SUBMITTED', 'REVISION'] }
    where.dueDate = { lt: new Date() }
  }
  if (args.dueBefore || args.dueAfter) {
    where.dueDate = {
      ...(typeof where.dueDate === 'object' ? where.dueDate : {}),
      ...(args.dueBefore ? { lte: new Date(args.dueBefore) } : {}),
      ...(args.dueAfter ? { gte: new Date(args.dueAfter) } : {}),
    }
  }

  const limit = Math.min(Math.max(args.limit ?? 20, 1), 50)

  const [invoices, count, aggregate] = await Promise.all([
    prisma.invoice.findMany({
      where,
      take: limit,
      orderBy: { dueDate: 'asc' },
      include: { vendor: { select: { name: true } }, company: { select: { name: true } } },
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where, _sum: { totalAmount: true, paidAmount: true } }),
  ])

  return {
    totalMatched: count,
    sumTotalAmount: aggregate._sum.totalAmount?.toNumber() ?? 0,
    sumPaidAmount: aggregate._sum.paidAmount?.toNumber() ?? 0,
    invoices: invoices.map((inv) => ({
      invoiceNumber: inv.invoiceNumber,
      vendorName: inv.vendor.name,
      companyName: inv.company?.name ?? null,
      status: inv.status,
      currency: inv.currency,
      totalAmount: inv.totalAmount.toNumber(),
      dueDate: inv.dueDate?.toISOString().slice(0, 10) ?? null,
      paidDate: inv.paidDate?.toISOString().slice(0, 10) ?? null,
      paidAmount: inv.paidAmount?.toNumber() ?? null,
    })),
  }
}

function systemInstruction() {
  const today = new Date().toISOString().slice(0, 10)
  return `You are the AI assistant embedded in an Invoice Tracking system, used by Admin and GA Manager staff. Answer in the same language the user writes in (Indonesian or English). Today's date is ${today}. Amounts default to IDR (Indonesian Rupiah) unless an invoice's own currency says otherwise.

Invoice status meanings: SUBMITTED = received, outcome not yet recorded; PAID/CANCELLED/REJECTED/VOID = terminal outcomes; REVISION = sent back to the vendor to fix and resubmit. There is no in-app approval workflow — GA Staff/GA Manager/Admin record a status outcome after the real-world payment decision happens outside the app.

Always call query_invoices for anything involving real invoice data (specific invoices, totals, counts, overdue lists, vendor/company breakdowns) rather than guessing. You may answer general questions about how the app works directly, without calling the tool.`
}

export async function runChat(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[],
): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) throw new Error('GOOGLE_API_KEY is not configured')

  const ai = new GoogleGenAI({ apiKey })
  const tools = [{ functionDeclarations: [queryInvoicesDeclaration] }]

  const contents: Content[] = [
    ...history.slice(-10).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ]

  const first = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: { systemInstruction: systemInstruction(), tools },
  })

  const calls = first.functionCalls
  if (!calls || calls.length === 0) {
    return first.text ?? 'Maaf, saya tidak bisa memproses pertanyaan itu.'
  }

  const modelTurn = first.candidates?.[0]?.content
  if (modelTurn) contents.push(modelTurn)

  for (const call of calls) {
    const result = await executeQueryInvoices((call.args ?? {}) as QueryInvoicesArgs)
    contents.push(
      createUserContent(
        createPartFromFunctionResponse(call.id ?? call.name ?? 'query_invoices', call.name ?? 'query_invoices', result),
      ),
    )
  }

  const second = await ai.models.generateContent({
    model: MODEL,
    contents,
    config: { systemInstruction: systemInstruction(), tools },
  })

  return second.text ?? 'Maaf, saya tidak bisa memproses pertanyaan itu.'
}
