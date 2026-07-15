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
  sendDate: isoDateString.optional().nullable(),
  picId: z.string().uuid().optional().nullable(),
})

export const INVOICE_STATUSES = ['SUBMITTED', 'CANCELLED', 'REJECTED', 'VOID', 'REVISION'] as const

export const updateInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1).max(100).optional(),
  invoiceDate: isoDateString.optional().nullable(),
  dueDate: isoDateString.optional().nullable(),
  currency: z.string().length(3).optional(),
  subtotal: z.number().nonnegative().optional().nullable(),
  taxAmount: z.number().nonnegative().optional().nullable(),
  totalAmount: z.number().min(0).optional(),
  notes: z.string().max(2000).optional().nullable(),
  status: z.enum(INVOICE_STATUSES).optional(),
  ocrConfidence: z.number().min(0).max(100).optional().nullable(),
  sendDate: isoDateString.optional().nullable(),
  deliveredDate: isoDateString.optional().nullable(),
  picId: z.string().uuid().optional().nullable(),
  comment: z.string().max(2000).optional(),
})

export const createUserSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email(),
    role: z.enum(['ADMIN', 'MANAGER', 'FINANCE', 'VIEWER', 'GA_STAFF', 'GA_MANAGER', 'VENDOR']),
    vendorId: z.string().uuid().optional().nullable(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  })
  .refine((d) => d.role !== 'VENDOR' || !!d.vendorId, {
    message: 'vendorId is required for VENDOR role',
    path: ['vendorId'],
  })

export const VALID_TRANSITIONS: Record<string, string[]> = {
  SUBMITTED: ['CANCELLED', 'REJECTED', 'VOID', 'REVISION'],
  REVISION: ['SUBMITTED'],
  CANCELLED: [],
  REJECTED: [],
  VOID: [],
}

// deliveredDate (GA Staff received the hardcopy) can never predate sendDate (vendor sent it)
export function validateDeliveryDates(
  sendDate: string | Date | null | undefined,
  deliveredDate: string | Date | null | undefined,
): { valid: boolean; message?: string } {
  if (!sendDate || !deliveredDate) return { valid: true }
  if (new Date(deliveredDate) < new Date(sendDate)) {
    return { valid: false, message: 'deliveredDate cannot be earlier than sendDate' }
  }
  return { valid: true }
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
      details: error.issues.map((e) => `${e.path.join('.')}: ${e.message}`),
    },
    { status: 400 },
  )
}
