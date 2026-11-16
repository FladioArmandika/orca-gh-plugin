// The plugin's worker: finds the GitHub repos inside an Orca project and answers the panel with
// their pull requests, through the gh CLI. Orca transpiles this file when it loads.
import type { OrcaWorkerApi } from 'orca/worker'
import type { ActionResult, MergeDefaults, MergeMethod, ProjectInfo, ProjectPrs, RepoInfo, RepoPrs } from './protocol'
import { byMergeOrder, parseList } from './shared/group'
import { act, defaultBranch, gh, listPrs, viewerLogin, viewPr } from './worker/gh'
import { candidateFor, createPr } from './worker/newpr'
import { describeRepo, discoverRepos } from './worker/repos'

type Workspace = { id: string; name: string; projectId?: string | null; path: string; hostId: string | null }
type Context = {
  projects: ProjectInfo[]
  workspaces: Workspace[]
  focused: Workspace | null
  focusedProjectId: string | null
}
type Settings = { defaults: MergeDefaults; scanDepth: number; prLimit: number; newPrBase: string }

const LIST_TTL_MS = 60_000
const DEFAULT_KEEP = 'main master development develop staging production release'
const DEFAULT_ORDER = 'be backend api server'

const method = (value: unknown, fallback: MergeMethod): MergeMethod =>
  value === 'squash' || value === 'merge' || value === 'rebase' ? value : fallback
const text = (value: unknown, fallback: string): string => (typeof value === 'string' ? value.trim() : fallback)
const int = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
const slugOk = (slug: unknown): slug is string => typeof slug === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug)
const numberOk = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0

export async function readSettings(orca: OrcaWorkerApi): Promise<Settings> {
  let s: Record<string, unknown> = {}
  try {
    s = (await orca.settings.get()) as Record<string, unknown>
  } catch {
    // No settings:own (tests, an older grant): every default applies.
  }
  const releaseBranch = text(s.releaseBranch, 'main')
  const keep = parseList(s.keepBranches ?? DEFAULT_KEEP)
  if (releaseBranch && !keep.includes(releaseBranch.toLowerCase())) keep.push(releaseBranch.toLowerCase())
  return {
    defaults: {
      mergeMethod: method(s.mergeMethod, 'squash'),
      releaseBranch,
      releaseMergeMethod: method(s.releaseMergeMethod, 'merge'),
      deleteBranch: s.deleteBranch !== false,
      keepBranches: keep,
      mergeOrder: parseList(s.mergeOrder ?? DEFAULT_ORDER),
      agent: text(s.reviewAgent, '')
    },
    scanDepth: int(s.scanDepth, 2, 1, 3),
    prLimit: int(s.prLimit, 50, 5, 100),
    newPrBase: text(s.newPrBase, '')
  }
}

function findWorkspace(list: readonly Workspace[], id: string): Workspace | null {
  return list.find((w) => w.id === id) ?? list.find((w) => w.id.endsWith(`::${id}`) || id.endsWith(`::${w.id}`)) ?? null
}

export async function readContext(orca: OrcaWorkerApi): Promise<Context> {
  const [p, w, c] = await Promise.all([
    orca.host.call('project.list').catch(() => null),
    orca.host.call('workspace.list').catch(() => null),
    orca.host.call('workspace.readContext').catch(() => null)
  ])
  // The worker runs on this machine: projects on SSH hosts or other runtimes are out of reach.
  const projects: ProjectInfo[] = (p?.projects ?? [])
    .filter((x) => !x.hidden && (x.hostId === 'local' || x.hostId === null))
    .map((x) => ({ id: x.id, name: x.name, kind: x.kind, path: x.path }))
  const ids = new Set(projects.map((x) => x.id))
  const workspaces: Workspace[] = (w?.workspaces ?? []).filter((ws) => !!ws.projectId && ids.has(ws.projectId))
  const focused = c?.workspaceId ? findWorkspace(workspaces, c.workspaceId) : null
  return { projects, workspaces, focused, focusedProjectId: focused?.projectId ?? null }
}

/** The base most of the project's feature PRs go into (`development` when work branches from it,
 *  though GitHub's default branch is `main`); release PRs, whose head is a kept branch, are left
 *  out. Null when there are none. */
export function usualBase(prs: readonly { head: string; base: string }[], keep: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const pr of prs) {
    if (keep.includes(pr.head.toLowerCase())) continue
    counts.set(pr.base, (counts.get(pr.base) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** Where to look for repos: the focused workspace when it is one of the project's (a worktree
 *  has its own branch), else the project's folder. */
function rootFor(project: ProjectInfo, ctx: Context): string {
  return ctx.focused && ctx.focused.projectId === project.id ? ctx.focused.path : project.path
}

export default function activate(orca: OrcaWorkerApi): void {
  const lists = new Map<string, { at: number; data: ProjectPrs }>()
  const inflight = new Map<string, Promise<ProjectPrs>>()
  /** Every repo the worker has seen, by slug, so later requests name repos the panel listed. */
  const known = new Map<string, RepoInfo>()
  let viewer: string | null = null

  async function me(): Promise<string | null> {
    if (!viewer) viewer = await viewerLogin()
    return viewer
  }

  const repoFor = (slug: string): RepoInfo & { slug: string } => {
    const repo = known.get(slug)
    return { ...(repo ?? { name: slug.split('/')[1], path: '', branch: null, problem: null }), slug }
  }

  function changed(repos: string[]): void {
    lists.clear()
    orca.panels.post('prs.changed', { repos })
  }

  async function fetchList(project: ProjectInfo, root: string, settings: Settings): Promise<ProjectPrs> {
    const base = { project, viewer: null, repos: [] as RepoPrs[], fetchedAt: Date.now(), defaults: settings.defaults }
    const repos = await discoverRepos(root, settings.scanDepth)
    for (const repo of repos) if (repo.slug) known.set(repo.slug, repo)
    let login: string | null
    try {
      login = await me()
    } catch (error) {
      return { ...base, repos: repos.map((repo) => ({ repo, prs: [], error: null })), error: (error as Error).message }
    }
    const results = await Promise.all(
      repos.map(async (repo): Promise<RepoPrs> => {
        if (!repo.slug) return { repo, prs: [], error: repo.problem }
        try {
          return { repo, prs: await listPrs({ ...repo, slug: repo.slug }, settings.prLimit, login), error: null }
        } catch (error) {
          return { repo, prs: [], error: (error as Error).message }
        }
      })
    )
    return { ...base, viewer: login, repos: results, error: null }
  }

  async function listProject(projectId: string | null, refresh: boolean): Promise<ProjectPrs> {
    const [settings, ctx] = await Promise.all([readSettings(orca), readContext(orca)])
    const project = ctx.projects.find((p) => p.id === (projectId || ctx.focusedProjectId)) ?? null
    if (!project) {
      return {
        project: null,
        viewer,
        repos: [],
        fetchedAt: Date.now(),
        defaults: settings.defaults,
        error: projectId ? 'That project is no longer in Orca.' : null
      }
    }
    const root = rootFor(project, ctx)
    const key = `${project.id}|${root}`
    const cached = lists.get(key)
    if (!refresh && cached && Date.now() - cached.at < LIST_TTL_MS) return { ...cached.data, defaults: settings.defaults }
    const running = inflight.get(key)
    if (running) return running
    const next = fetchList(project, root, settings)
      .then((data) => {
        if (!data.error) lists.set(key, { at: Date.now(), data })
        return data
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, next)
    return next
  }

  orca.panels.handle('projects.list', async () => {
    const ctx = await readContext(orca)
    return { projects: ctx.projects, focusedProjectId: ctx.focusedProjectId }
  })

  orca.panels.handle('prs.list', ({ projectId, refresh }) => listProject(projectId ?? null, refresh === true))

  orca.panels.handle('pr.detail', async ({ repo, number }) => {
    if (!slugOk(repo) || !numberOk(number)) return { detail: null, error: 'Unknown pull request' }
    try {
      return { detail: await viewPr(repoFor(repo), number, await me()), error: null }
    } catch (error) {
      return { detail: null, error: (error as Error).message }
    }
  })

  async function keepFor(slug: string, settings: Settings): Promise<string[]> {
    const fallback = await defaultBranch(slug)
    return fallback ? [...settings.defaults.keepBranches, fallback.toLowerCase()] : settings.defaults.keepBranches
  }

  async function merge(
    repo: string,
    number: number,
    options: { method?: MergeMethod; deleteBranch?: boolean; sha?: string },
    settings: Settings
  ): Promise<ActionResult> {
    let head: { headRefName: string; headRefOid: string; state: string }
    try {
      head = JSON.parse(await gh(['pr', 'view', String(number), '-R', repo, '--json', 'headRefName,headRefOid,state']))
    } catch (error) {
      return { ok: false, message: `${repo}#${number}: ${(error as Error).message}` }
    }
    if (head.state !== 'OPEN') return { ok: false, message: `${repo}#${number} is ${head.state.toLowerCase()}, not open` }
    if (options.sha && options.sha !== head.headRefOid) {
      return { ok: false, message: `${repo}#${number} has new commits since it was listed. Refresh and look again.` }
    }
    const keep = options.deleteBranch ? await keepFor(repo, settings) : []
    return act({ repo, number, action: 'merge', ...options }, head.headRefName, keep)
  }

  orca.panels.handle('pr.act', async (input) => {
    if (!slugOk(input.repo) || !numberOk(input.number)) return { ok: false, message: 'Unknown pull request' }
    const settings = await readSettings(orca)
    const result =
      input.action === 'merge'
        ? await merge(input.repo, input.number, input, settings)
        : await act(input, null, settings.defaults.keepBranches)
    if (result.ok) changed([input.repo])
    return result
  })

  orca.panels.handle('group.merge', async ({ prs, method: chosen, deleteBranch }) => {
    const settings = await readSettings(orca)
    const valid = prs.filter((pr) => slugOk(pr.repo) && numberOk(pr.number))
    const ordered = byMergeOrder(
      valid.map((pr) => ({ ...pr, repoName: repoFor(pr.repo).name })),
      settings.defaults.mergeOrder
    )
    const results: { key: string; ok: boolean; message: string }[] = []
    let stopped = false
    for (const pr of ordered) {
      const key = `${pr.repo}#${pr.number}`
      if (stopped) {
        results.push({ key, ok: false, message: `${pr.repoName}#${pr.number}: not merged, an earlier merge failed` })
        continue
      }
      const result = await merge(pr.repo, pr.number, { method: chosen, deleteBranch, sha: pr.sha }, settings)
      results.push({ key, ...result })
      if (!result.ok) stopped = true
    }
    if (results.some((r) => r.ok)) changed(ordered.map((pr) => pr.repo))
    return { results }
  })

  orca.panels.handle('pr.candidates', async ({ projectId }) => {
    const list = await listProject(projectId ?? null, false)
    if (!list.project) return { candidates: [], error: list.error }
    const settings = await readSettings(orca)
    const prs = list.repos.flatMap((r) => r.prs)
    const open = new Set(prs.map((pr) => `${pr.repo}|${pr.head}`))
    const usual = usualBase(prs, settings.defaults.keepBranches)
    const candidates = await Promise.all(
      list.repos.map(async ({ repo }) => {
        if (!repo.slug) return null
        const base = settings.newPrBase || usual || (await defaultBranch(repo.slug)) || 'main'
        return candidateFor(repo, base, (slug, branch) => open.has(`${slug}|${branch}`), settings.defaults.keepBranches)
      })
    )
    return { candidates: candidates.flatMap((c) => (c ? [c] : [])), error: list.error }
  })

  /** A repo the worker found itself, looking again when an idle restart emptied its memory: the
   *  panel never names an arbitrary folder. */
  async function foundRepo(projectId: string | null, path: string): Promise<RepoInfo | null> {
    const find = () => [...known.values()].find((repo) => repo.path === path) ?? null
    if (find()) return find()
    await listProject(projectId, false)
    return find()
  }

  orca.panels.handle('pr.create', async ({ projectId, repoPath, base, draft }) => {
    const seen = await foundRepo(projectId ?? null, repoPath)
    if (!seen || typeof base !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(base)) {
      return { ok: false, message: 'Unknown repo or base branch. Refresh and try again.', url: null }
    }
    const repo = await describeRepo(seen.path, seen.name)
    const result = await createPr(repo, base, draft === true)
    if (result.ok && repo.slug) changed([repo.slug])
    return result
  })

  orca.panels.handle('agent.review', async ({ projectId, prs }) => {
    const [settings, ctx] = await Promise.all([readSettings(orca), readContext(orca)])
    const agent = settings.defaults.agent
    if (!agent) return { ok: false, message: 'Set "Agent for Review with agent" in Settings → Plugins → Project PRs first.' }
    const project = ctx.projects.find((p) => p.id === (projectId || ctx.focusedProjectId))
    if (!project) return { ok: false, message: 'Pick a project first.' }
    const workspace =
      ctx.focused?.projectId === project.id ? ctx.focused : ctx.workspaces.find((w) => w.projectId === project.id)
    if (!workspace) return { ok: false, message: `Open a workspace of ${project.name} in Orca first.` }
    const items = prs.filter((pr) => slugOk(pr.repo) && numberOk(pr.number))
    if (items.length === 0) return { ok: false, message: 'Nothing to review.' }
    if (items.some((pr) => !known.has(pr.repo))) await listProject(project.id, false)
    const lines = items.map((pr) => {
      const path = known.get(pr.repo)?.path
      return `- ${pr.repo}#${pr.number}${path ? ` (local clone: ${path})` : ''}`
    })
    const prompt = [
      items.length > 1
        ? 'Review these pull requests together; they are one change across repos:'
        : 'Review this pull request:',
      ...lines,
      '',
      'Read each with `gh pr view <number> -R <repo>` and `gh pr diff <number> -R <repo>`, follow the repo\'s own guidelines (CONTRIBUTING.md and any agent instruction files), and report findings ranked by severity with file:line.',
      'Do not push, merge, approve or comment on GitHub unless I ask.'
    ].join('\n')
    try {
      await orca.host.call('agent.launch', { workspaceId: workspace.id, agent, prompt })
      return { ok: true, message: `Started ${agent} in ${workspace.name} to review ${items.length} PR${items.length > 1 ? 's' : ''}` }
    } catch (error) {
      return { ok: false, message: `Could not start ${agent}: ${(error as Error).message}` }
    }
  })
}

