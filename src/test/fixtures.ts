// Made-up pull requests and projects the tests and check scenarios share.
import type { ChecksSummary, PrDetail, PrSummary, ProjectPrs, RepoInfo } from '../protocol'
import { titleParts } from '../shared/title'

const NOW = Date.UTC(2026, 10, 16, 9, 0, 0)
export const green: ChecksSummary = { total: 3, passed: 3, failed: 0, pending: 0, skipped: 0, notRun: 0 }
export const red: ChecksSummary = { total: 3, passed: 2, failed: 1, pending: 0, skipped: 0, notRun: 0 }
export const neverRan: ChecksSummary = { total: 2, passed: 0, failed: 0, pending: 0, skipped: 0, notRun: 2 }

export const repos: RepoInfo[] = [
  { name: 'shop-be', short: 'be', path: '/work/shop/shop-be', slug: 'acme/shop-be', branch: 'feat/42-gift-cards', problem: null },
  { name: 'shop-fe', short: 'fe', path: '/work/shop/shop-fe', slug: 'acme/shop-fe', branch: 'development', problem: null },
  { name: 'shop-admin', short: 'admin', path: '/work/shop/shop-admin', slug: 'acme/shop-admin', branch: 'development', problem: null }
]

export function pr(over: Partial<PrSummary> & Pick<PrSummary, 'repo' | 'number'>): PrSummary {
  const repoName = over.repoName ?? over.repo.split('/')[1]
  const head = over.head ?? 'feat/42-gift-cards'
  const title = over.title ?? 'feat(cards): gift cards at checkout (42)'
  const task = over.task === undefined ? '42' : over.task
  const parts = titleParts(title, task)
  return {
    key: `${over.repo}#${over.number}`,
    repoName,
    repoLabel: repoName.replace(/^shop-/, ''),
    title,
    headline: parts.headline,
    kind: parts.kind,
    url: `https://github.com/${over.repo}/pull/${over.number}`,
    author: 'octo',
    head,
    headSha: `sha-${over.number}`,
    base: 'development',
    draft: false,
    reviewDecision: 'APPROVED',
    mergeState: 'CLEAN',
    mergeable: 'MERGEABLE',
    checks: green,
    updatedAt: NOW - over.number * 60_000,
    additions: 10,
    deletions: 2,
    labels: [],
    reviewRequestedFromMe: false,
    mine: false,
    autoMerge: false,
    task,
    taskTitle: task === '42' ? 'Gift cards at checkout' : null,
    taskUrl: task === '42' ? 'https://tasks.example.com/42' : null,
    waitsFor: [],
    ...over
  }
}

export const fePr = pr({
  repo: 'acme/shop-fe',
  number: 31,
  checks: red,
  mergeState: 'UNSTABLE',
  reviewDecision: 'REVIEW_REQUIRED',
  reviewRequestedFromMe: true
})
export const bePr = pr({ repo: 'acme/shop-be', number: 77 })
export const lonePr = pr({
  repo: 'acme/shop-admin',
  number: 9,
  head: 'fix/typo',
  title: 'fix: typo on the login page',
  task: null,
  mine: true
})

export function projectPrs(over: Partial<ProjectPrs> = {}): ProjectPrs {
  return {
    project: { id: 'p1', name: 'shop', kind: 'folder', path: '/work/shop' },
    viewer: 'octo',
    repos: [
      { repo: repos[0], prs: [bePr], error: null },
      { repo: repos[1], prs: [fePr], error: null },
      { repo: repos[2], prs: [lonePr], error: null }
    ],
    fetchedAt: NOW,
    defaults: {
      mergeMethod: 'squash',
      releaseBranch: 'main',
      releaseMergeMethod: 'merge',
      developBranch: 'development',
      deleteBranch: true,
      keepBranches: ['main', 'development'],
      mergeOrder: ['be', 'backend'],
      agent: 'codex',
      refreshMinutes: 3
    },
    ciNote: null,
    error: null,
    ...over
  }
}

export function detailOf(summary: PrSummary, over: Partial<PrDetail> = {}): PrDetail {
  return {
    ...summary,
    state: 'OPEN',
    body: 'Adds **gift cards**.',
    createdAt: NOW - 86_400_000,
    changedFiles: 2,
    files: [
      { path: 'src/cards/gift.ts', additions: 8, deletions: 1 },
      { path: 'src/cards/gift.test.ts', additions: 2, deletions: 1 }
    ],
    checkRuns: [
      { name: 'build', state: 'passed', url: 'https://github.com/acme/runs/1', note: null },
      { name: 'test', state: 'passed', url: null, note: null }
    ],
    timeline: [{ kind: 'review', author: 'lead', at: NOW - 3_600_000, body: 'Looks good', state: 'APPROVED' }],
    reviewers: [{ login: 'lead', state: 'APPROVED' }],
    flags: [],
    ...over
  }
}
