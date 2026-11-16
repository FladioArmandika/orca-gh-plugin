// Switching a repo's working tree to a branch, as a task's review needs: fetch it, then switch
// (creating the local branch from the remote one when needed) and fast-forward. A repo with
// uncommitted changes is left alone.
import type { ActionResult } from '../protocol'
import { errorLine, run, type Run } from './exec'
import { branchOk } from './release'
import { remoteOf } from './repos'

async function git(path: string, args: string[], runner: Run, timeoutMs = 10_000) {
  try {
    return await runner('git', ['-C', path, ...args], { timeoutMs })
  } catch (error) {
    return { code: -1, stdout: '', stderr: (error as Error).message }
  }
}

export async function switchBranch(path: string, name: string, branch: string, runner: Run = run): Promise<ActionResult> {
  if (!branchOk(branch)) return { ok: false, message: `${name}: bad branch name` }
  const status = await git(path, ['status', '--porcelain'], runner)
  if (status.code !== 0) return { ok: false, message: `${name}: ${errorLine(status)}` }
  if (status.stdout.trim()) return { ok: false, message: `${name}: has uncommitted changes, left on its branch` }
  const remote = (await remoteOf(path, runner))?.name ?? 'origin'
  const fetch = await git(path, ['fetch', remote, `refs/heads/${branch}:refs/remotes/${remote}/${branch}`], runner, 60_000)
  if (fetch.code !== 0) return { ok: false, message: `${name}: could not fetch ${branch}: ${errorLine(fetch)}` }
  const local = await git(path, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], runner)
  const switched =
    local.code === 0
      ? await git(path, ['switch', branch], runner)
      : await git(path, ['switch', '--track', '-c', branch, `${remote}/${branch}`], runner)
  if (switched.code !== 0) return { ok: false, message: `${name}: ${errorLine(switched)}` }
  if (local.code === 0) {
    const ff = await git(path, ['merge', '--ff-only', `${remote}/${branch}`], runner)
    if (ff.code !== 0) return { ok: true, message: `${name}: on ${branch}, which differs from ${remote} (not updated)` }
  }
  return { ok: true, message: `${name}: on ${branch}` }
}
