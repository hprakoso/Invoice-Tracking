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
  companyId: z.string().uuid('Invalid company ID').optional().nullable(),
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

export const INVOICE_STATUSES = ['SUBMITTED', 'PAID', 'CANCELLED', 'REJECTED', 'VOID', 'REVISION'] as const

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
  paidDate: isoDateString.optional().nullable(),
  paidAmount: z.number().nonnegative().optional().nullable(),
  companyId: z.string().uuid().optional().nullable(),
  comment: z.string().max(2000).optional(),
})

export const createCompanySchema = z.object({
  name: z.string().min(1, 'Company name required').max(200),
  npwp: z.string().max(50).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  email: z.string().email().optional().nullable(),
})

export const updateCompanySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  npwp: z.string().max(50).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  email: z.string().email().optional().nullable(),
  isActive: z.boolean().optional(),
})

export const createVendorSchema = z.object({
  name: z.string().min(1, 'Vendor name required').max(200),
  npwp: z.string().max(50).optional().nullable(),
  contactName: z.string().max(200).optional().nullable(),
  contactEmail: z.string().email().optional().nullable(),
  bankName: z.string().max(100).optional().nullable(),
  bankAccount: z.string().max(50).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  bankAccountHolder: z.string().max(200).optional().nullable(),
  bankBranch: z.string().max(100).optional().nullable(),
})

// Superset of every field any role may submit — the route filters which of
// these a given caller may actually write (name/npwp are ADMIN-only; VENDOR
// self-editing gets everything else). See allowedVendorFields() in the route.
export const updateVendorSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  npwp: z.string().max(50).optional().nullable(),
  contactName: z.string().max(200).optional().nullable(),
  contactEmail: z.string().email().optional().nullable(),
  bankName: z.string().max(100).optional().nullable(),
  bankAccount: z.string().max(50).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  bankAccountHolder: z.string().max(200).optional().nullable(),
  bankBranch: z.string().max(100).optional().nullable(),
  isActive: z.boolean().optional(),
})

export const vendorContactSchema = z.object({
  name: z.string().min(1, 'Contact name required').max(200),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  role: z.string().max(100).optional().nullable(),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
})

export const REMINDER_TYPES = ['due_soon', 'overdue', 'invoice_submitted', 'revision_requested'] as const
const REMINDER_ROLES = ['ADMIN', 'GA_STAFF', 'GA_MANAGER', 'VENDOR'] as const

export const updateReminderSettingSchema = z.object({
  isActive: z.boolean().optional(),
  daysBefore: z.number().int().positive().max(30).optional().nullable(),
  recipientRoles: z.array(z.enum(REMINDER_ROLES)).optional(),
  extraEmails: z.array(z.string().email()).optional(),
  emailEnabled: z.boolean().optional(),
  inAppEnabled: z.boolean().optional(),
})

export const createUserSchema = z
  .object({
    name: z.string().min(1).max(200),
    email: z.string().email(),
    role: z.enum(['ADMIN', 'GA_STAFF', 'GA_MANAGER', 'VENDOR']),
    vendorId: z.string().uuid().optional().nullable(),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  })
  .refine((d) => d.role !== 'VENDOR' || !!d.vendorId, {
    message: 'vendorId is required for VENDOR role',
    path: ['vendorId'],
  })

export const VALID_TRANSITIONS: Record<string, string[]> = {
  SUBMITTED: ['PAID', 'CANCELLED', 'REJECTED', 'VOID', 'REVISION'],
  REVISION: ['SUBMITTED'],
  PAID: [],
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
