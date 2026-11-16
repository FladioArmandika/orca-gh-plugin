// Merge dependencies written in pull request descriptions: "Merge after be#12", "depends on
// #12", "built on acme/shop-be#3", "after https://github.com/acme/shop/pull/9".

/** A pull request a description names. `repo` is `owner/name`, a repo name or the end of one
 *  (`be` for shop-be), or null for the same repo. */
export type DepRef = { repo: string | null; number: number }

const WORDS = String.raw`(?:after|depends\s+on|requires|blocked\s+by|built\s+on|on\s+top\s+of|follows)`
const SHORT = new RegExp(String.raw`\b${WORDS}\s+(?:the\s+)?(?:pr\s+)?\x60?((?:[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+)?#(\d+)`, 'gi')
const URL = new RegExp(String.raw`\b${WORDS}\s+(?:the\s+)?(?:pr\s+)?<?https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/pull\/(\d+)`, 'gi')

export function parseDependencies(body: string | null | undefined): DepRef[] {
  const text = body ?? ''
  const found = new Map<string, DepRef>()
  for (const pattern of [SHORT, URL]) {
    for (const match of text.matchAll(pattern)) {
      const ref = { repo: match[1] ?? null, number: Number(match[2]) }
      if (Number.isInteger(ref.number) && ref.number > 0) found.set(`${ref.repo ?? ''}#${ref.number}`, ref)
    }
  }
  return [...found.values()]
}

type RepoName = { slug: string; name: string }

/** The `owner/name#number` key a reference points at, among the project's repos; null when it
 *  names no repo here or more than one. */
export function resolveDependency(ref: DepRef, from: RepoName, repos: readonly RepoName[]): string | null {
  if (!ref.repo) return `${from.slug}#${ref.number}`
  const token = ref.repo.toLowerCase()
  if (token.includes('/')) {
    const repo = repos.find((r) => r.slug.toLowerCase() === token)
    return repo ? `${repo.slug}#${ref.number}` : null
  }
  const matches = repos.filter((r) => {
    const names = [r.name.toLowerCase(), r.slug.split('/')[1]?.toLowerCase() ?? '']
    return names.some((n) => n === token || n.endsWith(`-${token}`) || n.endsWith(`_${token}`))
  })
  return matches.length === 1 ? `${matches[0].slug}#${ref.number}` : null
}
