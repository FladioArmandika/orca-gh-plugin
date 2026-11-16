// Repos whose checked-out branch could become a pull request, and opening one.
import type { ActionResult, NewPrCandidate, RepoInfo } from '../protocol'
import { errorLine, run, type Run } from './exec'
import { gh } from './gh'
import { remoteOf } from './repos'

async function git(path: string, args: string[], runner: Run, timeoutMs = 5_000) {
  try {
    return await runner('git', ['-C', path, ...args], { timeoutMs })
  } catch (error) {
    return { code: -1, stdout: '', stderr: (error as Error).message }
  }
}

async function count(path: string, range: string, runner: Run): Promise<number | null> {
  const result = await git(path, ['rev-list', '--count', range], runner)
  const n = Number.parseInt(result.stdout.trim(), 10)
  return result.code === 0 && Number.isFinite(n) ? n : null
}

export async function candidateFor(
  repo: RepoInfo,
  base: string,
  hasOpenPr: (repo: string, branch: string) => boolean,
  keep: readonly string[],
  runner: Run = run
): Promise<NewPrCandidate | null> {
  const branch = repo.branch
  if (!repo.slug || !branch || branch === base || keep.includes(branch.toLowerCase())) return null
  if (hasOpenPr(repo.slug, branch)) return null
  const remote = (await remoteOf(repo.path, runner))?.name ?? 'origin'
  const [ahead, upstream, status] = await Promise.all([
    count(repo.path, `${remote}/${base}..HEAD`, runner),
    git(repo.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], runner),
    git(repo.path, ['status', '--porcelain'], runner)
  ])
  if (ahead === 0) return null
  const unpushed = upstream.code === 0 ? await count(repo.path, '@{u}..HEAD', runner) : null
  return { repo, branch, base, ahead, unpushed, dirty: status.code === 0 && status.stdout.trim().length > 0 }
}

/** Pushes the branch when it has unpushed commits or no upstream, then `gh pr create --fill`. */
export async function createPr(
  repo: RepoInfo,
  base: string,
  draft: boolean,
  runner: Run = run
): Promise<ActionResult & { url: string | null }> {
  if (!repo.slug || !repo.branch) return { ok: false, message: `${repo.name}: no GitHub remote or no branch`, url: null }
  const remote = (await remoteOf(repo.path, runner))?.name ?? 'origin'
  const upstream = await git(repo.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], runner)
  const unpushed = upstream.code === 0 ? await count(repo.path, '@{u}..HEAD', runner) : null
  if (unpushed === null || unpushed > 0) {
    const push = await git(repo.path, ['push', '-u', remote, `HEAD:refs/heads/${repo.branch}`], runner, 120_000)
    if (push.code !== 0) return { ok: false, message: `${repo.name}: push failed: ${errorLine(push)}`, url: null }
  }
  try {
    const stdout = await gh(
      ['pr', 'create', '-R', repo.slug, '--base', base, '--head', repo.branch, '--fill', ...(draft ? ['--draft'] : [])],
      runner,
      { cwd: repo.path, timeoutMs: 90_000 }
    )
    const url = stdout.trim().split('\n').reverse().find((line) => /^https?:\/\//.test(line.trim()))?.trim() ?? null
    return { ok: true, message: `Opened ${draft ? 'a draft ' : 'a '}pull request in ${repo.name}`, url }
  } catch (error) {
    return { ok: false, message: `${repo.name}: ${(error as Error).message}`, url: null }
  }
}
