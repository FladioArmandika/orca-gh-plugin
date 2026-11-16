// How a pull request's state reads in the panel: short badges in Orca's tones.
import type { Tone } from 'orca'
import type { ChecksSummary, PrSummary } from '../protocol'

export type Look = { text: string; tone: Tone }

export function reviewLook(decision: string | null): Look | null {
  switch (decision) {
    case 'APPROVED':
      return { text: 'Approved', tone: 'success' }
    case 'CHANGES_REQUESTED':
      return { text: 'Changes requested', tone: 'danger' }
    case 'REVIEW_REQUIRED':
      return { text: 'Review required', tone: 'warning' }
    default:
      return null
  }
}

export function checksLook(checks: ChecksSummary): Look | null {
  if (checks.total === 0) return null
  if (checks.failed > 0) return { text: `${checks.failed} failing`, tone: 'danger' }
  if (checks.notRun > 0) return { text: "Checks didn't run", tone: 'warning' }
  if (checks.pending > 0) return { text: `${checks.pending} pending`, tone: 'warning' }
  return { text: 'Checks pass', tone: 'success' }
}

export function checksLine(checks: ChecksSummary): string {
  if (checks.total === 0) return 'No checks'
  const parts = [
    checks.failed ? `${checks.failed} failing` : '',
    checks.notRun ? `${checks.notRun} didn't run` : '',
    checks.pending ? `${checks.pending} pending` : '',
    checks.passed ? `${checks.passed} passed` : '',
    checks.skipped ? `${checks.skipped} skipped` : ''
  ].filter(Boolean)
  return parts.join(' · ')
}

export function checksTone(checks: ChecksSummary): Tone | undefined {
  if (checks.failed) return 'danger'
  if (checks.notRun || checks.pending) return 'warning'
  return checks.total ? 'success' : undefined
}

export function mergeLook(pr: Pick<PrSummary, 'mergeState' | 'mergeable' | 'draft'>): Look | null {
  if (pr.draft) return null
  if (pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY') return { text: 'Conflicts', tone: 'danger' }
  switch (pr.mergeState) {
    case 'BEHIND':
      return { text: 'Behind base', tone: 'warning' }
    case 'CLEAN':
    case 'HAS_HOOKS':
      return { text: 'Can merge', tone: 'success' }
    case 'BLOCKED':
      return { text: 'Blocked', tone: 'neutral' }
    default:
      return null
  }
}

export function mergeLine(pr: Pick<PrSummary, 'mergeState' | 'mergeable' | 'draft'>): string {
  if (pr.draft) return 'Draft'
  if (pr.mergeable === 'CONFLICTING' || pr.mergeState === 'DIRTY') return 'Conflicts with the base branch'
  switch (pr.mergeState) {
    case 'CLEAN':
      return 'Able to merge'
    case 'HAS_HOOKS':
      return 'Able to merge (with hooks)'
    case 'BEHIND':
      return 'Behind the base branch'
    case 'BLOCKED':
      return 'Blocked by branch protection'
    case 'UNSTABLE':
      return 'Able to merge, some checks not passing'
    default:
      return 'Checking…'
  }
}

/** Every badge a list row shows, most important first. */
export function badges(pr: PrSummary): Look[] {
  const out: Look[] = []
  if (pr.draft) out.push({ text: 'Draft', tone: 'neutral' })
  if (pr.reviewRequestedFromMe) out.push({ text: 'Your review', tone: 'accent' })
  if (pr.autoMerge) out.push({ text: 'Auto-merge on', tone: 'accent' })
  for (const look of [reviewLook(pr.reviewDecision), checksLook(pr.checks), mergeLook(pr)]) {
    if (look) out.push(look)
  }
  return out
}
