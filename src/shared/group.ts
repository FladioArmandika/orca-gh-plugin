// Pure helpers both the panel and the worker use: task ids, grouping across repos, merge order
// and the list filters. No Node and no Orca runtime here.
import type { PrSummary } from '../protocol'

// `feat/1234-gift-cards`, `fix/fe-120-wishlist`, `chore/BE-52`
const TASK_IN_BRANCH = /^[^/]+\/((?:[A-Za-z]+-)?\d+)(?:[-_/.]|$)/
// `... (1234)`, `... (BE-52)`, `... (Tasks 987)`
const TASK_IN_TITLE = /\((?:tasks?\s+)?((?:[A-Za-z]+-)?\d+)\)\s*$/i

/** The task id a branch or title names, upper-cased; null when neither names one. */
export function taskOf(head: string, title: string): string | null {
  const branch = head.match(TASK_IN_BRANCH)
  if (branch) return branch[1].toUpperCase()
  const fromTitle = title.match(TASK_IN_TITLE)
  return fromTitle ? fromTitle[1].toUpperCase() : null
}

/** `"be, backend api"` → `['be', 'backend', 'api']`. */
export function parseList(setting: unknown): string[] {
  if (typeof setting !== 'string') return []
  return setting
    .split(/[\s,]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
}

/** Where a repo comes in the merge order: its name equals a token or ends with `-token`. */
export function repoRank(repoName: string, order: readonly string[]): number {
  const name = repoName.toLowerCase()
  const index = order.findIndex(
    (token) => name === token || name.endsWith(`-${token}`) || name.endsWith(`_${token}`) || name.endsWith(`/${token}`)
  )
  return index === -1 ? order.length : index
}

export function byMergeOrder<T extends { repoName: string }>(items: readonly T[], order: readonly string[]): T[] {
  return [...items].sort(
    (a, b) => repoRank(a.repoName, order) - repoRank(b.repoName, order) || a.repoName.localeCompare(b.repoName)
  )
}

export type PrGroup = {
  key: string
  /** `Task 1234`, or the branch when no task id is found. */
  label: string
  /** The branch every PR of the group shares; null when they differ. */
  branch: string | null
  prs: PrSummary[]
  updatedAt: number
}

export function groupKey(pr: Pick<PrSummary, 'task' | 'head'>): string {
  return pr.task ? `task:${pr.task}` : `branch:${pr.head}`
}

/** Pull requests of one task (or one branch name) across repos, each group in merge order,
 *  newest activity first. */
export function groupPrs(prs: readonly PrSummary[], order: readonly string[]): PrGroup[] {
  const groups = new Map<string, PrSummary[]>()
  for (const pr of prs) {
    const key = groupKey(pr)
    groups.set(key, [...(groups.get(key) ?? []), pr])
  }
  return [...groups.entries()]
    .map(([key, items]) => {
      const heads = new Set(items.map((pr) => pr.head))
      const branch = heads.size === 1 ? items[0].head : null
      const task = items[0].task
      return {
        key,
        label: task ? `Task ${task}` : items[0].head,
        branch,
        prs: byMergeOrder(items, order),
        updatedAt: Math.max(...items.map((pr) => pr.updatedAt))
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export type PrFilter = 'all' | 'review' | 'mine' | 'ready' | 'attention'

export const FILTERS: readonly { value: PrFilter; label: string }[] = [
  { value: 'all', label: 'All open' },
  { value: 'review', label: 'Needs my review' },
  { value: 'mine', label: 'Mine' },
  { value: 'ready', label: 'Ready to merge' },
  { value: 'attention', label: 'Needs attention' }
]

/** No failing or pending checks, no conflicts, and no review still owed or asking for changes. */
export function isReady(pr: PrSummary): boolean {
  return (
    !pr.draft &&
    pr.checks.failed === 0 &&
    pr.checks.pending === 0 &&
    pr.mergeable !== 'CONFLICTING' &&
    pr.reviewDecision !== 'CHANGES_REQUESTED' &&
    pr.reviewDecision !== 'REVIEW_REQUIRED'
  )
}

export function needsAttention(pr: PrSummary): boolean {
  return pr.checks.failed > 0 || pr.mergeable === 'CONFLICTING' || pr.reviewDecision === 'CHANGES_REQUESTED'
}

export function matches(pr: PrSummary, filter: PrFilter, hideDrafts: boolean, query: string): boolean {
  if (hideDrafts && pr.draft) return false
  if (filter === 'review' && !pr.reviewRequestedFromMe) return false
  if (filter === 'mine' && !pr.mine) return false
  if (filter === 'ready' && !isReady(pr)) return false
  if (filter === 'attention' && !needsAttention(pr)) return false
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [pr.title, pr.head, pr.author, pr.repoName, `#${pr.number}`, pr.task ?? '', ...pr.labels]
    .join('\n')
    .toLowerCase()
  return q.split(/\s+/).every((word) => haystack.includes(word))
}

/** The merge method for a PR: the release one when it goes into the release branch. */
export function methodFor(
  pr: Pick<PrSummary, 'base'>,
  defaults: { mergeMethod: string; releaseBranch: string; releaseMergeMethod: string }
): 'squash' | 'merge' | 'rebase' {
  const method = defaults.releaseBranch && pr.base === defaults.releaseBranch ? defaults.releaseMergeMethod : defaults.mergeMethod
  return method === 'merge' || method === 'rebase' ? method : 'squash'
}
