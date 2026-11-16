// The status bar item and notifications: what the followed project's pull requests add up to,
// and what changed since the last look that is worth a desktop notification.
import type { PrSummary, ProjectPrs } from '../protocol'
import { groupPrs, isReady, needsAttention, waitsOutside } from '../shared/group'

export type StatusText = { text: string; tone: 'neutral' | 'accent' | 'success' | 'warning'; tooltip: string; visible: boolean }

const name = (pr: PrSummary) => `${pr.repoLabel}#${pr.number}`

export function statusOf(data: ProjectPrs | null): StatusText {
  const prs = data?.repos.flatMap((r) => r.prs) ?? []
  const github = data?.repos.some((r) => r.repo.slug) ?? false
  if (!data?.project || data.error || !github) return { text: '', tone: 'neutral', tooltip: '', visible: false }
  const review = prs.filter((pr) => pr.reviewRequestedFromMe).length
  const ready = prs.filter(isReady).length
  const attention = prs.filter(needsAttention).length
  const parts = [`${prs.length} PR${prs.length === 1 ? '' : 's'}`]
  if (review) parts.push(`${review} to review`)
  if (ready) parts.push(`${ready} ready`)
  const details = [`${prs.length} open`, `${review} waiting for your review`, `${ready} ready to merge`, `${attention} need attention`]
  return {
    text: parts.join(' · '),
    tone: review ? 'accent' : ready ? 'success' : 'neutral',
    tooltip: `Project PRs in ${data.project.name}: ${details.join(', ')}. Press to refresh.`,
    visible: true
  }
}

/** What a later look is compared with. */
export type Snapshot = {
  review: Set<string>
  readyGroups: Set<string>
  decisions: Map<string, string | null>
}

export function snapshot(data: ProjectPrs): Snapshot {
  const prs = data.repos.flatMap((r) => r.prs)
  return {
    review: new Set(prs.filter((pr) => pr.reviewRequestedFromMe).map((pr) => pr.key)),
    readyGroups: new Set(readyGroups(prs, data.defaults.mergeOrder).map((g) => g.key)),
    decisions: new Map(prs.filter((pr) => pr.mine).map((pr) => [pr.key, pr.reviewDecision]))
  }
}

function readyGroups(prs: readonly PrSummary[], order: readonly string[]) {
  return groupPrs(prs, order).filter((group) => {
    const open = group.prs.filter((pr) => !pr.draft)
    return open.length > 0 && open.every(isReady) && waitsOutside(open).length === 0
  })
}

export type Note = { title: string; body: string }

/** Review requests that are new, tasks that just became ready to merge, and verdicts on the
 *  person's own pull requests; none on the first look, at most three (else one summary). */
export function whatChanged(before: Snapshot | null, data: ProjectPrs): Note[] {
  if (!before) return []
  const prs = data.repos.flatMap((r) => r.prs)
  const notes: Note[] = []
  for (const pr of prs) {
    if (pr.reviewRequestedFromMe && !before.review.has(pr.key)) {
      notes.push({ title: `Review requested: ${name(pr)}`, body: `${pr.headline} (by ${pr.author})` })
    }
  }
  for (const group of readyGroups(prs, data.defaults.mergeOrder)) {
    if (before.readyGroups.has(group.key)) continue
    const open = group.prs.filter((pr) => !pr.draft)
    notes.push({
      title: `${group.prs.length > 1 ? group.label : name(open[0])} is ready to merge`,
      body: `${open.map(name).join(' → ')}: checks pass, nothing it waits for is open.`
    })
  }
  for (const pr of prs) {
    if (!pr.mine || !before.decisions.has(pr.key)) continue
    const was = before.decisions.get(pr.key)
    if (pr.reviewDecision === was) continue
    if (pr.reviewDecision === 'APPROVED') notes.push({ title: `${name(pr)} approved`, body: pr.headline })
    if (pr.reviewDecision === 'CHANGES_REQUESTED') notes.push({ title: `Changes requested on ${name(pr)}`, body: pr.headline })
  }
  if (notes.length <= 3) return notes
  return [{ title: `${notes.length} pull request updates in ${data.project?.name ?? 'your project'}`, body: notes.map((n) => n.title).join('; ') }]
}

/** Changes that matter to an open panel: a pull request opened, closed, pushed, reviewed or its
 *  checks moved. */
export function fingerprint(data: ProjectPrs): string {
  return data.repos
    .flatMap((r) => r.prs.map((pr) => `${pr.key}:${pr.headSha}:${pr.reviewDecision}:${pr.mergeState}:${JSON.stringify(pr.checks)}:${pr.autoMerge}`))
    .sort()
    .join('|')
}
