import { describe, it, expect } from 'vitest'
import { foldStageLeadTimes } from '../services/dashboardStats'

const at = (day: number) => new Date(Date.UTC(2026, 0, day))
const row = (invoiceId: string, stage: string, day: number) => ({ invoiceId, stage, changedAt: at(day) })
const byStage = (rows: ReturnType<typeof foldStageLeadTimes>, stage: string) =>
  rows.find((r) => r.stage === stage)!

describe('foldStageLeadTimes', () => {
  it('measures a stage by the gap to the next stage of the same invoice', () => {
    const out = foldStageLeadTimes([
      row('inv1', 'GA', 1),
      row('inv1', 'BUDGET', 4), // GA took 3 days
      row('inv1', 'SSU', 9), // BUDGET took 5 days
    ])
    expect(byStage(out, 'GA').avgDays).toBe(3)
    expect(byStage(out, 'BUDGET').avgDays).toBe(5)
  })

  it('counts the last row per invoice as currently-held, not as a duration', () => {
    const out = foldStageLeadTimes([row('inv1', 'GA', 1), row('inv1', 'BUDGET', 4)])
    // BUDGET is where the invoice sits now — no completed duration for it.
    expect(byStage(out, 'BUDGET')).toMatchObject({ avgDays: null, completed: 0, currentCount: 1 })
    expect(byStage(out, 'GA')).toMatchObject({ completed: 1, currentCount: 0 })
  })

  it('does not measure across an invoice boundary', () => {
    // Without the invoiceId check, inv1's last row and inv2's first row would
    // be read as a 10-day GA duration.
    const out = foldStageLeadTimes([row('inv1', 'GA', 1), row('inv2', 'GA', 11)])
    expect(byStage(out, 'GA')).toMatchObject({ avgDays: null, completed: 0, currentCount: 2 })
  })

  it('averages across invoices', () => {
    const out = foldStageLeadTimes([
      row('inv1', 'GA', 1), row('inv1', 'BUDGET', 3), // 2 days
      row('inv2', 'GA', 1), row('inv2', 'BUDGET', 7), // 6 days
    ])
    expect(byStage(out, 'GA')).toMatchObject({ avgDays: 4, completed: 2 })
  })

  it('always returns every stage, in workflow order, even with no data', () => {
    const out = foldStageLeadTimes([])
    expect(out.map((r) => r.stage)).toEqual(['GA', 'BUDGET', 'PROC_LEGAL', 'SSU', 'TREASURY'])
    expect(out.every((r) => r.avgDays === null && r.completed === 0 && r.currentCount === 0)).toBe(true)
  })

  it('handles a backwards correction without producing a negative duration', () => {
    // Rows arrive ordered by time, so a stage recorded out of workflow order
    // is still a forward gap in elapsed time.
    const out = foldStageLeadTimes([
      row('inv1', 'TREASURY', 1),
      row('inv1', 'GA', 3), // corrected backwards; TREASURY still held 2 days
      row('inv1', 'BUDGET', 4),
    ])
    expect(byStage(out, 'TREASURY').avgDays).toBe(2)
    expect(byStage(out, 'GA').avgDays).toBe(1)
    expect(out.every((r) => r.avgDays === null || r.avgDays >= 0)).toBe(true)
  })
})
