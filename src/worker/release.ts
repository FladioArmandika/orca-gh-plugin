// Releases: how far each repo's develop branch is ahead of its release branch, and opening the
// develop → release pull request that lists what it brings.
import type { ActionResult } from '../protocol'
import { run, type Run } from './exec'
import { gh } from './gh'

const BRANCH = /^[A-Za-z0-9._/-]+$/
const SHOWN = 30
const LISTED = 50

export const branchOk = (branch: unknown): branch is string =>
  typeof branch === 'string' && BRANCH.test(branch) && !branch.startsWith('-') && !branch.includes('..')

export type Compare = { ahead: number; behind: number; commits: string[] }

/** GitHub's compare of `base...head`: commits ahead and behind, and the subjects ahead, newest first. */
export async function compare(slug: string, base: string, head: string, runner: Run = run): Promise<Compare> {
  if (!branchOk(base) || !branchOk(head)) throw new Error('Bad branch name')
  const out = await gh(
    [
      'api',
      `repos/${slug}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      '--jq',
      '{ahead: .ahead_by, behind: .behind_by, commits: [.commits[].commit.message | split("\\n")[0]]}'
    ],
    runner
  )
  const parsed = JSON.parse(out) as { ahead?: number; behind?: number; commits?: string[] }
  const commits = (parsed.commits ?? []).filter((c) => typeof c === 'string').reverse()
  return { ahead: parsed.ahead ?? 0, behind: parsed.behind ?? 0, commits: commits.slice(0, SHOWN) }
}

export function releaseTitle(head: string, base: string, now = new Date()): string {
  return `Release ${head} to ${base} (${now.toISOString().slice(0, 10)})`
}

export function releaseBody(head: string, base: string, commits: readonly string[], ahead: number): string {
  const lines = commits.slice(0, LISTED).map((c) => `- ${c}`)
  const more = ahead > lines.length ? [`- … and ${ahead - lines.length} more`] : []
  return [`Merges ${head} into ${base}.`, '', ...lines, ...more].join('\n')
}

export async function openRelease(
  slug: string,
  base: string,
  head: string,
  runner: Run = run
): Promise<ActionResult & { url: string | null }> {
  const name = slug.split('/')[1] ?? slug
  try {
    const { ahead, commits } = await compare(slug, base, head, runner)
    if (ahead === 0) return { ok: false, message: `${name}: ${head} has nothing ${base} lacks`, url: null }
    const out = await gh(
      [
        'pr',
        'create',
        '-R',
        slug,
        '--base',
        base,
        '--head',
        head,
        '--title',
        releaseTitle(head, base),
        '--body',
        releaseBody(head, base, commits, ahead)
      ],
      runner,
      { timeoutMs: 60_000 }
    )
    const url = out.trim().split('\n').reverse().find((line) => /^https?:\/\//.test(line.trim()))?.trim() ?? null
    return { ok: true, message: `Opened the release pull request of ${name}`, url }
  } catch (error) {
    return { ok: false, message: `${name}: ${(error as Error).message}`, url: null }
  }
}
