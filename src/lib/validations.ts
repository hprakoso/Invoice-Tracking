import { z } from 'zod'
import { NextResponse } from 'next/server'

const isoDateString = z.string().refine((v) => !isNaN(Date.parse(v)), {
  message: 'Invalid date format',
})

const itemSchema = z.object({
  description: z.string().min(1, 'Item description required'),
  quantity: z.number().positive().optional(),
  unitPrice: z.number().nonnegative().optional(),
  total: z.number().min(0, 'Item total must be non-negative'),
})

export const createInvoiceSchema = z.object({
  vendorId: z.string().uuid('Invalid vendor ID'),
  invoiceNumber: z.string().min(1, 'Invoice number required').max(100),
  invoiceDate: isoDateString.optional().nullable(),
  dueDate: isoDateString.optional().nullable(),
  currency: z.string().length(3).default('IDR'),
  subtotal: z.number().nonnegative().optional().nullable(),
  taxAmount: z.number().nonnegative().optional().nullable(),
  totalAmount: z.number().min(0, 'Total amount must be non-negative'),
  notes: z.string().max(2000).optional().nullable(),
  items: z.array(itemSchema).default([]),
})

export const updateInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1).max(100).optional(),
  invoiceDate: isoDateString.optional().nullable(),
  dueDate: isoDateString.optional().nullable(),
  currency: z.string().length(3).optional(),
  subtotal: z.number().nonnegative().optional().nullable(),
  taxAmount: z.number().nonnegative().optional().nullable(),
  totalAmount: z.number().min(0).optional(),
  notes: z.string().max(2000).optional().nullable(),
  status: z
    .enum(['PENDING_OCR', 'PENDING_REVIEW', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID'])
    .optional(),
  ocrConfidence: z.number().min(0).max(100).optional().nullable(),
})

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING_OCR: ['PENDING_REVIEW', 'PENDING_APPROVAL', 'REJECTED'],
  PENDING_REVIEW: ['PENDING_OCR', 'PENDING_APPROVAL', 'REJECTED'],
  PENDING_APPROVAL: ['PENDING_OCR', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'],
  APPROVED: ['PAID', 'PENDING_APPROVAL'],
  REJECTED: ['PENDING_OCR', 'PENDING_REVIEW'],
  PAID: [],
}

export function isValidStatusTransition(
  from: string,
  to: string,
): { valid: boolean; message?: string } {
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed) {
    return { valid: false, message: `Unknown status: ${from}` }
  }
  if (!allowed.includes(to)) {
    return {
      valid: false,
      message: `Cannot transition from ${from} to ${to}. Allowed: ${allowed.join(', ')}`,
    }
  }
  return { valid: true }
}

export function validationErrorResponse(
  error: z.ZodError,
): NextResponse<{ error: string; details: string[] }> {
  return NextResponse.json(
    {
      error: 'Validation failed',
      details: error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
    },
    { status: 400 },
  )
}
