// Every GitHub call goes through the gh CLI; the plugin keeps no token of its own.
import { tmpdir } from 'node:os'
import type {
  ActionResult,
  CheckState,
  ChecksSummary,
  MergeMethod,
  PrAction,
  PrDetail,
  PrSummary,
  RepoInfo,
  TimelineItem
} from '../protocol'
import { parseDependencies, type DepRef } from '../shared/deps'
import { taskOf } from '../shared/group'
import { taskLink, titleParts } from '../shared/title'
import { errorLine, notFound, run, type Run } from './exec'

// gh runs outside any clone so `-R` alone picks the repo, and `merge --delete-branch` never
// switches branches in the person's working tree.
const NEUTRAL_CWD = tmpdir()

const LIST_FIELDS = [
  'number',
  'title',
  'url',
  'author',
  'headRefName',
  'headRefOid',
  'baseRefName',
  'isDraft',
  'reviewDecision',
  'mergeStateStatus',
  'mergeable',
  'statusCheckRollup',
  'updatedAt',
  'additions',
  'deletions',
  'labels',
  'reviewRequests',
  'autoMergeRequest',
  'body'
].join(',')

const DETAIL_FIELDS = [
  LIST_FIELDS,
  'state',
  'createdAt',
  'changedFiles',
  'files',
  'reviews',
  'comments'
].join(',')

export class GhError extends Error {}

export const GH_MISSING = 'The gh CLI was not found. Install it from https://cli.github.com and run `gh auth login`.'

export async function gh(args: string[], runner: Run = run, options: { cwd?: string; timeoutMs?: number } = {}): Promise<string> {
  let result
  try {
    result = await runner('gh', args, { cwd: options.cwd ?? NEUTRAL_CWD, timeoutMs: options.timeoutMs ?? 30_000 })
  } catch (error) {
    if (notFound(error)) throw new GhError(GH_MISSING)
    throw new GhError(`gh did not finish: ${(error as Error).message}`)
  }
  if (result.code !== 0) throw new GhError(errorLine(result))
  return result.stdout
}

async function ghJson<T>(args: string[], runner: Run): Promise<T> {
  const stdout = await gh(args, runner)
  try {
    return JSON.parse(stdout) as T
  } catch {
    throw new GhError('gh printed something that is not JSON')
  }
}

type RawCheck = {
  __typename?: string
  name?: string
  context?: string
  status?: string
  conclusion?: string
  state?: string
  detailsUrl?: string
  targetUrl?: string
}

type RawPr = {
  number: number
  title: string
  url: string
  author?: { login?: string } | null
  headRefName: string
  headRefOid?: string
  baseRefName: string
  isDraft?: boolean
  reviewDecision?: string | null
  mergeStateStatus?: string
  mergeable?: string
  statusCheckRollup?: RawCheck[] | null
  updatedAt?: string
  additions?: number
  deletions?: number
  labels?: { name?: string }[] | null
  reviewRequests?: { __typename?: string; login?: string; name?: string; slug?: string }[] | null
  autoMergeRequest?: unknown
  body?: string
}

type RawDetail = RawPr & {
  state?: string
  createdAt?: string
  changedFiles?: number
  files?: { path?: string; additions?: number; deletions?: number }[] | null
  reviews?: { author?: { login?: string } | null; state?: string; body?: string; submittedAt?: string }[] | null
  comments?: { author?: { login?: string } | null; body?: string; createdAt?: string }[] | null
}

export function checkState(check: RawCheck): CheckState {
  const isStatus = check.__typename === 'StatusContext' || (check.status === undefined && check.state !== undefined)
  if (isStatus) {
    if (check.state === 'SUCCESS') return 'passed'
    if (check.state === 'PENDING' || check.state === 'EXPECTED') return 'pending'
    return 'failed'
  }
  if (check.status !== 'COMPLETED') return 'pending'
  switch (check.conclusion) {
    case 'SUCCESS':
      return 'passed'
    case 'NEUTRAL':
    case 'SKIPPED':
      return 'skipped'
    case 'FAILURE':
    case 'TIMED_OUT':
    case 'CANCELLED':
    case 'ACTION_REQUIRED':
    case 'STARTUP_FAILURE':
    case 'STALE':
      return 'failed'
    default:
      return 'pending'
  }
}

/** Skipped and neutral checks are counted apart; neither blocks a merge. Checks that never ran
 *  start as failed: the worker moves them to `notRun` once it has asked GitHub why. */
export function summarizeChecks(rollup: readonly RawCheck[] | null | undefined): ChecksSummary {
  const summary = { total: 0, passed: 0, failed: 0, pending: 0, skipped: 0, notRun: 0 }
  for (const check of rollup ?? []) {
    const state = checkState(check)
    summary.total++
    if (state === 'failed') summary.failed++
    else if (state === 'pending') summary.pending++
    else if (state === 'skipped') summary.skipped++
    else summary.passed++
  }
  return summary
}

const time = (value: string | undefined): number => {
  const ms = value ? Date.parse(value) : NaN
  return Number.isFinite(ms) ? ms : 0
}

/** The Actions job id in a check's details URL (`.../actions/runs/1/job/2`): GitHub's check run id. */
export function jobIdOf(url: string | null | undefined): string | null {
  return url?.match(/\/actions\/runs\/\d+\/job\/(\d+)/)?.[1] ?? null
}

export function toSummary(raw: RawPr, repo: RepoInfo & { slug: string }, viewer: string | null): PrSummary {
  const me = viewer?.toLowerCase() ?? null
  const author = raw.author?.login ?? 'ghost'
  const task = taskOf(raw.headRefName, raw.title)
  const { kind, headline } = titleParts(raw.title, task)
  const link = taskLink(raw.body)
  return {
    key: `${repo.slug}#${raw.number}`,
    repo: repo.slug,
    repoName: repo.name,
    repoLabel: repo.short || repo.name,
    number: raw.number,
    title: raw.title,
    headline,
    kind,
    url: raw.url,
    author,
    head: raw.headRefName,
    headSha: raw.headRefOid ?? '',
    base: raw.baseRefName,
    draft: raw.isDraft === true,
    reviewDecision: raw.reviewDecision || null,
    mergeState: raw.mergeStateStatus ?? 'UNKNOWN',
    mergeable: raw.mergeable ?? 'UNKNOWN',
    checks: summarizeChecks(raw.statusCheckRollup),
    updatedAt: time(raw.updatedAt),
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    labels: (raw.labels ?? []).flatMap((l) => (l?.name ? [l.name] : [])),
    reviewRequestedFromMe: me !== null && (raw.reviewRequests ?? []).some((r) => r?.login?.toLowerCase() === me),
    mine: me !== null && author.toLowerCase() === me,
    autoMerge: !!raw.autoMergeRequest,
    task,
    taskTitle: link?.title ?? null,
    taskUrl: link?.url ?? null,
    waitsFor: []
  }
}

const clip = (text: string | undefined, max: number): string => {
  const value = (text ?? '').replace(/\r\n/g, '\n').trim()
  return value.length > max ? `${value.slice(0, max)}\n\n… (cut; open it on GitHub for the rest)` : value
}

const FLAGS: readonly { test: RegExp; text: string }[] = [
  { test: /(^|\/)migrations?(\/|\.|-|_)/i, text: 'Adds or changes a database migration' },
  { test: /(^|\/)(auth|oauth|session|login|jwt)[^/]*(\/|\.)/i, text: 'Touches authentication code' },
  { test: /(payment|stripe|billing|invoice|checkout)/i, text: 'Touches payment or billing code' }
]

export function flagsFor(paths: readonly string[]): string[] {
  return FLAGS.filter((flag) => paths.some((path) => flag.test.test(path))).map((flag) => flag.text)
}

export function toDetail(raw: RawDetail, repo: RepoInfo & { slug: string }, viewer: string | null): PrDetail {
  const reviews = raw.reviews ?? []
  const timeline: TimelineItem[] = [
    ...(raw.comments ?? []).map((c) => ({
      kind: 'comment' as const,
      author: c.author?.login ?? 'ghost',
      at: time(c.createdAt),
      body: clip(c.body, 4_000),
      state: null
    })),
    ...reviews
      .filter((r) => r.body?.trim() || (r.state && r.state !== 'COMMENTED'))
      .map((r) => ({
        kind: 'review' as const,
        author: r.author?.login ?? 'ghost',
        at: time(r.submittedAt),
        body: clip(r.body, 4_000),
        state: r.state ?? null
      }))
  ]
    .sort((a, b) => a.at - b.at)
    .slice(-40)
  const latest = new Map<string, string>()
  for (const review of [...reviews].sort((a, b) => time(a.submittedAt) - time(b.submittedAt))) {
    const login = review.author?.login
    if (!login || !review.state || review.state === 'PENDING') continue
    if (review.state === 'COMMENTED' && latest.has(login)) continue
    latest.set(login, review.state)
  }
  const files = (raw.files ?? []).flatMap((f) =>
    f?.path ? [{ path: f.path, additions: f.additions ?? 0, deletions: f.deletions ?? 0 }] : []
  )
  const checkRuns = (raw.statusCheckRollup ?? []).map((c) => ({
    name: c.name || c.context || 'check',
    state: checkState(c),
    url: c.detailsUrl || c.targetUrl || null,
    note: null
  }))
  return {
    ...toSummary(raw, repo, viewer),
    state: raw.state ?? 'OPEN',
    body: clip(raw.body, 12_000),
    createdAt: time(raw.createdAt),
    changedFiles: raw.changedFiles ?? files.length,
    files: files.slice(0, 300),
    checkRuns: checkRuns.slice(0, 100),
    timeline,
    reviewers: [...latest.entries()].map(([login, state]) => ({ login, state })),
    flags: flagsFor(files.map((f) => f.path))
  }
}

export async function viewerLogin(runner: Run = run): Promise<string | null> {
  try {
    return (await gh(['api', 'user', '--jq', '.login'], runner)).trim() || null
  } catch (error) {
    if (error instanceof GhError && error.message === GH_MISSING) throw error
    return null
  }
}

/** A listed pull request with the dependencies its description names and its failed Actions
 *  jobs, before the worker resolves them against the project. */
export type ListedPr = PrSummary & { deps: DepRef[]; failedJobs: string[] }

export function failedJobs(rollup: readonly RawCheck[] | null | undefined): string[] {
  return (rollup ?? []).flatMap((c) => {
    const id = checkState(c) === 'failed' ? jobIdOf(c.detailsUrl) : null
    return id ? [id] : []
  })
}

export async function listPrs(
  repo: RepoInfo & { slug: string },
  limit: number,
  viewer: string | null,
  runner: Run = run
): Promise<ListedPr[]> {
  const raw = await ghJson<RawPr[]>(
    ['pr', 'list', '-R', repo.slug, '--state', 'open', '--limit', String(limit), '--json', LIST_FIELDS],
    runner
  )
  return raw.map((pr) => ({
    ...toSummary(pr, repo, viewer),
    deps: parseDependencies(pr.body),
    failedJobs: failedJobs(pr.statusCheckRollup)
  }))
}

export async function viewPr(
  repo: RepoInfo & { slug: string },
  number: number,
  viewer: string | null,
  runner: Run = run
): Promise<PrDetail> {
  const raw = await ghJson<RawDetail>(['pr', 'view', String(number), '-R', repo.slug, '--json', DETAIL_FIELDS], runner)
  return toDetail(raw, repo, viewer)
}

export async function defaultBranch(slug: string, runner: Run = run): Promise<string | null> {
  try {
    return (await gh(['repo', 'view', slug, '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name'], runner)).trim() || null
  } catch {
    return null
  }
}

export type ActInput = {
  repo: string
  number: number
  action: PrAction
  body?: string
  method?: MergeMethod
  deleteBranch?: boolean
  sha?: string
}

/** The gh arguments for an action, or an error message when the input cannot work. */
export function actionArgs(input: ActInput, head: string | null, keep: readonly string[]): string[] | string {
  const pr = [String(input.number), '-R', input.repo]
  const body = input.body?.trim() ?? ''
  switch (input.action) {
    case 'approve':
      return ['pr', 'review', ...pr, '--approve', ...(body ? ['--body', body] : [])]
    case 'request-changes':
      return body ? ['pr', 'review', ...pr, '--request-changes', '--body', body] : 'Write what needs to change first.'
    case 'comment':
      return body ? ['pr', 'comment', ...pr, '--body', body] : 'Write a comment first.'
    case 'merge':
    case 'auto-merge': {
      const method = input.method ?? 'squash'
      const args = ['pr', 'merge', ...pr, ...(input.action === 'auto-merge' ? ['--auto'] : []), `--${method}`]
      if (input.sha) args.push('--match-head-commit', input.sha)
      if (input.deleteBranch && head && !keep.includes(head.toLowerCase())) args.push('--delete-branch')
      return args
    }
    case 'cancel-auto-merge':
      return ['pr', 'merge', ...pr, '--disable-auto']
    case 'ready':
      return ['pr', 'ready', ...pr]
    case 'draft':
      return ['pr', 'ready', ...pr, '--undo']
    case 'close':
      return ['pr', 'close', ...pr]
    case 'reopen':
      return ['pr', 'reopen', ...pr]
    case 'update-branch':
      return ['pr', 'update-branch', ...pr]
    default:
      return `Unknown action: ${String(input.action)}`
  }
}

const DONE: Record<PrAction, string> = {
  approve: 'Approved',
  'request-changes': 'Requested changes on',
  comment: 'Commented on',
  merge: 'Merged',
  'auto-merge': 'Turned on auto-merge for',
  'cancel-auto-merge': 'Turned off auto-merge for',
  ready: 'Marked ready for review:',
  draft: 'Converted to draft:',
  close: 'Closed',
  reopen: 'Reopened',
  'update-branch': 'Updated the branch of'
}

export async function act(input: ActInput, head: string | null, keep: readonly string[], runner: Run = run): Promise<ActionResult> {
  const args = actionArgs(input, head, keep)
  if (typeof args === 'string') return { ok: false, message: args }
  const name = `${input.repo.split('/')[1] ?? input.repo}#${input.number}`
  try {
    await gh(args, runner, { timeoutMs: 90_000 })
  } catch (error) {
    return { ok: false, message: `${name}: ${(error as Error).message}` }
  }
  let message = `${DONE[input.action]} ${name}`
  if (input.action === 'merge' || input.action === 'auto-merge') {
    message += ` (${input.method ?? 'squash'})`
    if (input.action === 'auto-merge') message += ': it merges once its checks pass'
    if (args.includes('--delete-branch')) message += `, ${input.action === 'auto-merge' ? 'then deletes' : 'deleted'} ${head}`
    else if (input.deleteBranch && head) message += `, kept ${head}`
  }
  return { ok: true, message }
}
