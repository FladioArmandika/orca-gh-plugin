// One file's diff of a pull request. `gh pr diff` gives the whole patch; the worker splits it by
// file and keeps the last few pull requests' patches, by head commit, so moving between files
// costs nothing.
import { run, type Run } from './exec'
import { gh } from './gh'

// A panel text holds at most 16 KiB.
const MAX_PATCH = 14_000
const KEEP = 4

/** `diff --git a/x b/y` sections by their new path. */
export function splitDiff(diff: string): Map<string, string> {
  const files = new Map<string, string>()
  const sections = diff.split(/^(?=diff --git )/m)
  for (const section of sections) {
    const header = section.match(/^diff --git a\/(.+?) b\/(.+)$/m)
    if (header) files.set(header[2].trim(), section.replace(/\s+$/, ''))
  }
  return files
}

/** The patch cut at a line end so it fits a panel. */
export function clipPatch(patch: string, max = MAX_PATCH): { text: string; truncated: boolean } {
  if (patch.length <= max) return { text: patch, truncated: false }
  const cut = patch.lastIndexOf('\n', max)
  return { text: patch.slice(0, cut > 0 ? cut : max), truncated: true }
}

export class DiffCache {
  private readonly diffs = new Map<string, Map<string, string>>()

  constructor(private readonly runner: Run = run) {}

  async file(slug: string, number: number, sha: string, path: string): Promise<{ text: string; truncated: boolean } | null> {
    const key = `${slug}#${number}@${sha}`
    let files = this.diffs.get(key)
    if (!files) {
      files = splitDiff(await gh(['pr', 'diff', String(number), '-R', slug], this.runner, { timeoutMs: 60_000 }))
      this.diffs.set(key, files)
      while (this.diffs.size > KEEP) this.diffs.delete(this.diffs.keys().next().value as string)
    }
    const patch = files.get(path)
    return patch === undefined ? null : clipPatch(patch)
  }
}
