import { Resend } from 'resend'

const FROM = process.env.RESEND_FROM_EMAIL ?? 'Invoice Tracking <onboarding@resend.dev>'
const APP_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

// No-op when RESEND_API_KEY isn't configured — reminder/notification triggers
// call this unconditionally, and shouldn't fail (or crash the daily cron) just
// because email delivery hasn't been set up yet.
export async function sendEmail(to: string[], subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey || to.length === 0) return

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({ from: FROM, to, subject, html })
  if (error) {
    console.error(`Resend send failed: ${error.message}`)
  }
}

// Shared branded wrapper for every notification email — table-based layout +
// inline styles only, no <style> block or flex/grid, so it renders
// consistently in Gmail/Outlook rather than just modern browsers.
export function renderEmailLayout(opts: {
  heading: string
  bodyHtml: string
  ctaText?: string
  ctaPath?: string // relative path, e.g. '/invoices/abc123' — joined with NEXTAUTH_URL
}): string {
  const cta =
    opts.ctaText && opts.ctaPath
      ? `<tr><td style="padding:8px 40px 32px;">
           <a href="${APP_URL}${opts.ctaPath}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;">${opts.ctaText}</a>
         </td></tr>`
      : ''
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
            <tr>
              <td style="background:#171717;padding:24px 40px;">
                <span style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.02em;">Invoice Tracking</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 40px 8px;">
                <h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#18181b;">${opts.heading}</h1>
                <div style="font-size:14px;line-height:1.6;color:#3f3f46;">${opts.bodyHtml}</div>
              </td>
            </tr>
            ${cta}
            <tr>
              <td style="background:#fafafa;padding:20px 40px;border-top:1px solid #e4e4e7;">
                <p style="margin:0;font-size:12px;color:#a1a1aa;">Notifikasi otomatis dari Invoice Tracking. Mohon tidak membalas email ini.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
