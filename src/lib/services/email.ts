import { Resend } from 'resend'

const FROM = process.env.RESEND_FROM_EMAIL ?? 'Invoice Tracking <onboarding@resend.dev>'

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
