import { z } from 'zod'
import { NextResponse } from 'next/server'
import { INVOICE_STATUSES } from './invoiceStatus'

/**
 * A calendar date. Accepts 'YYYY-MM-DD' or a full ISO timestamp and normalises
 * to the date part, because these columns store dates and not instants.
 *
 * Previously this was only `!isNaN(Date.parse(v))`, which let two things
 * through: a value carrying a time component (stored as e.g. 03:00Z, which a
 * `dueDate <= '2026-09-07'` range filter then excluded, so the invoice
 * disappeared from the dashboard and the Excel export on its own due day while
 * the unfiltered list still showed it), and implausible years like '0202' or
 * '2205' from an OCR misread, which park an invoice in the wrong aging bucket
 * permanently and keep generating reminders forever.
 */
const isoDateString = z
  .string()
  .refine((v) => !isNaN(Date.parse(v)), { message: 'Invalid date format' })
  .refine(
    (v) => {
      const year = new Date(v).getUTCFullYear()
      return year >= 2000 && year <= new Date().getUTCFullYear() + 10
    },
    { message: 'Date is outside the supported range' },
  )
  .transform((v) => new Date(v).toISOString().slice(0, 10))

/**
 * An invoice cannot fall due before it was issued. Enforced here for payloads
 * carrying both dates, in the PATCH route against the stored value when only
 * one is sent, and by the `invoices_due_date_after_invoice_date` CHECK
 * constraint for every other write path. Dates are normalised date-only
 * strings by this point, so a lexicographic compare is a date compare.
 */
export function validateInvoiceDates(
  invoiceDate: string | Date | null | undefined,
  dueDate: string | Date | null | undefined,
): { valid: boolean; message?: string } {
  if (!invoiceDate || !dueDate) return { valid: true }
  if (new Date(dueDate) < new Date(invoiceDate)) {
    return { valid: false, message: 'dueDate cannot be earlier than invoiceDate' }
  }
  return { valid: true }
}

/**
 * The business bills in Rupiah only, so this is the one currency any new
 * invoice or edit may carry. It was `z.string().length(3)`, which accepted any
 * code — and nothing anywhere converts between currencies, so a USD total would
 * have been summed straight into Total Payable next to IDR ones.
 *
 * Scoped to WRITES on purpose. The column is untouched and there is no
 * migration: rows written before this keep whatever they hold, and every read
 * path (detail page, Excel export, chatbot) still renders them as stored.
 */
export const SUPPORTED_CURRENCIES = ['IDR'] as const
const currencySchema = z.enum(SUPPORTED_CURRENCIES)

const itemSchema = z.object({
  description: z.string().min(1, 'Item description required'),
  quantity: z.number().positive().optional(),
  unitPrice: z.number().nonnegative().optional(),
  total: z.number().min(0, 'Item total must be non-negative'),
})

// Pure constants/logic live in invoiceStatus.ts (no next/server import) so
// client components can import them directly without pulling in server-only
// code. Re-exported here so existing server-side importers of this module
// are unaffected.
export { INVOICE_STATUSES, TERMINAL_STATUSES, VALID_TRANSITIONS, isValidStatusTransition } from './invoiceStatus'

// PIC workflow stages, in display order — GA is the first stage after a
// vendor uploads an invoice.
export const PIC_STAGES = ['GA', 'BUDGET', 'PROC_LEGAL', 'SSU', 'TREASURY'] as const

/**
 * `invoices.po_number` is NOT NULL, but the document-first upload wizard has
 * no PO to write when it creates the pre-OCR draft row — the PO is read off
 * the document (or typed by the user) at the confirmation step, which happens
 * after the row must already exist. Draft rows therefore carry this marker
 * until then, and `assertReadyToGoLive` refuses to let one reach a live
 * invoice.
 *
 * Deliberately not 'N/A': migration 20260901000000 backfilled real pre-PO rows
 * with that string, so reusing it would make genuine historical data
 * indistinguishable from an unfinished draft.
 */
export const DRAFT_PO_PLACEHOLDER = 'PENDING-OCR'

export function isPlaceholderPoNumber(poNumber: string | null | undefined): boolean {
  return !poNumber?.trim() || poNumber.trim() === DRAFT_PO_PLACEHOLDER
}

export const createInvoiceSchema = z.object({
  vendorId: z.string().uuid('Invalid vendor ID'),
  companyId: z.string().uuid('Invalid company ID').optional().nullable(),
  // Trimmed: ' INV-001 ' and 'INV-001' are the same document, but both the
  // case-insensitive duplicate check and the lower() unique index treat padded
  // strings as distinct, so two live invoices could exist for one document.
  invoiceNumber: z.string().trim().min(1, 'Invoice number required').max(100),
  // Optional ONLY for a draft — see the refine below and DRAFT_PO_PLACEHOLDER.
  // A direct (non-draft) create still requires it exactly as before.
  poNumber: z.string().trim().min(1, 'PO number required').max(100).optional(),
  invoiceDate: isoDateString.optional().nullable(),
  dueDate: isoDateString.optional().nullable(),
  currency: currencySchema.default('IDR'),
  subtotal: z.number().nonnegative().optional().nullable(),
  taxAmount: z.number().nonnegative().optional().nullable(),
  totalAmount: z.number().min(0, 'Total amount must be non-negative'),
  notes: z.string().max(2000).optional().nullable(),
  items: z.array(itemSchema).default([]),
  sendDate: isoDateString.optional().nullable(),
  picId: z.string().uuid().optional().nullable(),
  picStage: z.enum(PIC_STAGES).optional(),
  // The upload wizard sets this so its pre-OCR placeholder row stays out of
  // every KPI, list and reminder until the review step is confirmed.
  isDraft: z.boolean().optional(),
})
  .refine((d) => validateInvoiceDates(d.invoiceDate, d.dueDate).valid, {
    message: 'dueDate cannot be earlier than invoiceDate',
    path: ['dueDate'],
  })
  // A draft may omit the PO (the wizard has not read the document yet); every
  // other caller must still supply one, so the pre-existing contract for
  // direct invoice creation is unchanged.
  .refine((d) => d.isDraft === true || !!d.poNumber, {
    message: 'PO number required',
    path: ['poNumber'],
  })
  // Only checked on create, where all three figures come from one source at
  // once. PATCH deliberately does NOT block this: a user correcting a single
  // misread field mid-review would otherwise be locked out until they fixed
  // every other one too.
  .refine(
    (d) =>
      d.subtotal == null ||
      d.taxAmount == null ||
      Math.abs(d.totalAmount - (d.subtotal + d.taxAmount)) <= 1,
    { message: 'totalAmount must equal subtotal + taxAmount', path: ['totalAmount'] },
  )

export const updateInvoiceSchema = z.object({
  invoiceNumber: z.string().trim().min(1).max(100).optional(),
  poNumber: z.string().trim().min(1).max(100).optional(),
  invoiceDate: isoDateString.optional().nullable(),
  dueDate: isoDateString.optional().nullable(),
  currency: currencySchema.optional(),
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
  isDraft: z.boolean().optional(),
})
  .refine((d) => validateInvoiceDates(d.invoiceDate, d.dueDate).valid, {
    message: 'dueDate cannot be earlier than invoiceDate',
    path: ['dueDate'],
  })

export const updateInvoiceStageSchema = z.object({
  stage: z.enum(PIC_STAGES),
})

export const DOCUMENT_TYPES = ['INVOICE', 'TAX_INVOICE', 'BAST', 'OTHER'] as const

export const updateDocumentTypeSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
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

// NOTE: `invoice_submitted` and `revision_requested` are configurable here and
// in /admin/reminders but nothing fires them — leftovers from the removed
// DRAFT/SUBMITTED/REVISION status model. Documented in docs/API.md; left in
// place rather than silently dropping settings an admin may have edited.
export const REMINDER_TYPES = [
  'due_soon', 'overdue', 'invoice_submitted', 'revision_requested', 'status_changed', 'stage_assigned',
] as const
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

/**
 * The draft -> live boundary. Nothing used to guard it: `isDraft: false` had
 * no precondition, so whatever placeholders the wizard created went live
 * untouched.
 *
 * It matters more now that neither value is collected before upload. A
 * placeholder PO is not inert — the dashboard and invoice list filter PO with
 * a `contains` match, so a shared token returns whole batches, and the Excel
 * export writes it verbatim. A null company is worse: the invoice still lists,
 * but it is unreachable from every company-scoped filter, KPI breakdown,
 * export and chatbot answer, with no queue anywhere flagging that it needs one.
 *
 * Both were already mandatory in practice — the old wizard hard-blocked on
 * them before the file was even chosen. This keeps the rule and only moves
 * where it is enforced, from the browser to the server.
 */
export function validateReadyToGoLive(invoice: {
  poNumber?: string | null
  companyId?: string | null
  /**
   * Documents currently attached. Required rather than optional so a caller
   * cannot forget it: before the document-first flow a file had to exist
   * before the row was even created, so "a live invoice with no document" was
   * unreachable. It is reachable now — the review step lets the user delete
   * documents — and such an invoice gives GA nothing to verify while still
   * carrying figures extracted from a file that no longer exists.
   */
  documentCount: number
}): { valid: boolean; message?: string } {
  if (invoice.documentCount < 1) {
    return { valid: false, message: 'At least one document is required before submitting this invoice' }
  }
  if (isPlaceholderPoNumber(invoice.poNumber)) {
    return { valid: false, message: 'PO number is required before submitting this invoice' }
  }
  if (!invoice.companyId) {
    return { valid: false, message: 'Bill-to company is required before submitting this invoice' }
  }
  return { valid: true }
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
