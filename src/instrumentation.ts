export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startReminderScheduler } = await import('@/lib/services/reminderScheduler')
    startReminderScheduler()
  }
}
