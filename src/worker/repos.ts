// Finding the Git repositories inside a project's folder, and the GitHub repo each one pushes to.
import { readdir, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import type { RepoInfo } from '../protocol'
import { shortNames } from '../shared/title'
import { run, type Run } from './exec'

const SLUG = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const SKIP = new Set(['node_modules', 'dist', 'build', 'vendor', 'Library', 'Applications', 'target', 'out'])

export type Remote = { host: string; slug: string }

/** `git@github.com:o/r.git`, `git@github.com-work:o/r.git`, `ssh://git@github.com/o/r`,
 *  `https://github.com/o/r.git` → `{ host, slug: 'o/r' }`; null for anything else. */
export function parseRemote(url: string): Remote | null {
  const text = url.trim()
  let host: string
  let path: string
  const web = text.match(/^(?:https?|git|ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i)
  const scp = text.match(/^(?:[^@/]+@)?([^/:]+):(?!\/)(.+)$/)
  if (web) [, host, path] = web
  else if (scp) [, host, path] = scp
  else return null
  const slug = path.replace(/\/+$/, '').replace(/\.git$/i, '')
  return SLUG.test(slug) ? { host: host.toLowerCase(), slug } : null
}

/** Whether a remote host is github.com, counting SSH aliases such as `github.com-work`. */
export function isGitHubHost(host: string): boolean {
  return host === 'github.com' || host === 'www.github.com' || /^github\.com[-_.]/.test(host)
}

/** The real host behind an SSH alias (`ssh -G`, which only reads the config). */
async function sshHostName(alias: string, runner: Run): Promise<string | null> {
  if (!/^[A-Za-z0-9_.-]+$/.test(alias)) return null
  try {
    const result = await runner('ssh', ['-G', alias], { timeoutMs: 3_000 })
    const line = result.stdout.split('\n').find((l) => l.startsWith('hostname '))
    return line ? line.slice('hostname '.length).trim().toLowerCase() : null
  } catch {
    return null
  }
}

async function git(path: string, args: string[], runner: Run): Promise<string | null> {
  try {
    const result = await runner('git', ['-C', path, ...args], { timeoutMs: 5_000 })
    return result.code === 0 ? result.stdout.trim() : null
  } catch {
    return null
  }
}

/** The remote a repo pushes pull requests to: `origin`, else its first remote. */
export async function remoteOf(path: string, runner: Run = run): Promise<{ name: string; url: string } | null> {
  const names = (await git(path, ['remote'], runner))?.split('\n').filter(Boolean) ?? []
  const name = names.includes('origin') ? 'origin' : names[0]
  if (!name) return null
  const url = await git(path, ['remote', 'get-url', name], runner)
  return url ? { name, url } : null
}

export async function describeRepo(path: string, name: string, runner: Run = run): Promise<RepoInfo> {
  const [remote, head] = await Promise.all([remoteOf(path, runner), git(path, ['rev-parse', '--abbrev-ref', 'HEAD'], runner)])
  const branch = head && head !== 'HEAD' ? head : null
  if (!remote) return { name, short: name, path, slug: null, branch, problem: 'No Git remote' }
  const parsed = parseRemote(remote.url)
  if (!parsed) return { name, short: name, path, slug: null, branch, problem: `Not a GitHub remote: ${remote.url}` }
  let github = isGitHubHost(parsed.host)
  if (!github) github = isGitHubHost((await sshHostName(parsed.host, runner)) ?? '')
  if (!github) return { name, short: name, path, slug: null, branch, problem: `Not on github.com: ${parsed.host}` }
  return { name, short: name, path, slug: parsed.slug, branch, problem: null }
}

async function isRepo(dir: string): Promise<boolean> {
  try {
    await stat(join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

/** The repos in `root`: itself when it is one, else every repo up to `depth` folders down (not
 *  inside another repo, skipping hidden and dependency folders), at most `limit`. */
export async function findRepoPaths(root: string, depth: number, limit = 40): Promise<string[]> {
  if (await isRepo(root)) return [root]
  const found: string[] = []
  let level = [root]
  let visited = 0
  for (let d = 0; d < depth && level.length > 0 && found.length < limit; d++) {
    const next: string[] = []
    for (const dir of level) {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP.has(entry.name)) continue
        if (++visited > 3_000) return found.sort()
        const child = join(dir, entry.name)
        if (await isRepo(child)) {
          found.push(child)
          if (found.length >= limit) return found.sort()
        } else next.push(child)
      }
    }
    level = next
  }
  return found.sort()
}

export async function discoverRepos(root: string, depth: number, runner: Run = run): Promise<RepoInfo[]> {
  const paths = await findRepoPaths(root, depth)
  const repos = await Promise.all(
    paths.map((path) => describeRepo(path, path === root ? basename(root) : relative(root, path), runner))
  )
  const short = shortNames(repos.map((repo) => repo.name))
  return repos.map((repo) => ({ ...repo, short: short.get(repo.name) ?? repo.name }))
}
