// How names read in the panel: titles without their prefix, short repo names, task links.

// `feat(cards): ...`, `fix!: ...`, `chore(deps)!: ...`
const KIND = /^\s*([a-z]+)(\([^)]*\))?(!)?:\s+/i
// `... (1234)`, `... (BE-52)`, `... (Tasks 987)`
const TASK_SUFFIX = /\s*\((?:tasks?\s+)?((?:[A-Za-z]+-)?\d+)\)\s*$/i

/** `feat(cards): gift cards at checkout (42)` → `{ kind: 'feat(cards)', headline: 'Gift cards at
 *  checkout' }`. The task suffix goes only when it is the pull request's own task. */
export function titleParts(title: string, task: string | null): { kind: string | null; headline: string } {
  const match = title.match(KIND)
  let rest = match ? title.slice(match[0].length) : title
  rest = rest.replace(TASK_SUFFIX, (all, id: string) => (task && id.toUpperCase() === task ? '' : all)).trim()
  const headline = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : title
  return { kind: match ? `${match[1]}${match[2] ?? ''}${match[3] ?? ''}` : null, headline }
}

/** Names without the prefix they all share, cut at a `-`, `_` or `.`: shop-be and shop-fe become
 *  be and fe. Names stay whole when there is one, or no shared prefix leaves each a name. */
export function shortNames(names: readonly string[]): Map<string, string> {
  const same = new Map(names.map((name) => [name, name]))
  if (names.length < 2) return same
  let prefix = names[0]
  for (const name of names) {
    while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1)
  }
  const cut = Math.max(prefix.lastIndexOf('-'), prefix.lastIndexOf('_'), prefix.lastIndexOf('.'))
  if (cut < 0) return same
  prefix = prefix.slice(0, cut + 1)
  if (names.some((name) => name.length <= prefix.length)) return same
  return new Map(names.map((name) => [name, name.slice(prefix.length)]))
}

const TASK_LINK = /(?:^|\n)\s*(?:\*\*|__)?task(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*:?\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/i

/** The task a description links on its `Task: [name](url)` line, with the name's own task
 *  suffix taken off. */
export function taskLink(body: string | null | undefined): { title: string; url: string } | null {
  const match = (body ?? '').match(TASK_LINK)
  if (!match) return null
  const title = match[1]
    .replace(/\s+/g, ' ')
    .replace(TASK_SUFFIX, '')
    .replace(/^(?:tasks?\s+)?(?:[A-Za-z]+-)?\d+\s*[:\-–]\s*/i, '')
    .trim()
  return title ? { title, url: match[2] } : null
}
