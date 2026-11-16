// The panel's state (atoms) and everything that talks to the worker.
import { atom, plugin, read, set, type Tone } from 'orca'
import type {
  MergeMethod,
  NewPrCandidate,
  PrAction,
  PrDetail,
  PrSummary,
  ProjectInfo,
  ProjectPrs,
  ReleaseRepo
} from '../protocol'
import type { PrFilter } from '../shared/group'

export type View = 'task' | 'repo' | 'new' | 'release'
export type Confirm = { title: string; body: string; label: string; tone: Tone; run: () => Promise<void> }
export type Release = { head: string; base: string; repos: ReleaseRepo[]; error: string | null }

export const projects = atom<ProjectInfo[]>([])
export const focusedProjectId = atom<string | null>(null)
/** The project picked by hand; '' follows the focused workspace. */
export const choice = atom('project', '', { persist: 'plugin' })
export const list = atom<ProjectPrs | null>(null)
export const listLoading = atom(false)
export const view = atom<View>('view', 'task', { persist: 'plugin' })
export const filter = atom<PrFilter>('filter', 'all', { persist: 'plugin' })
export const hideDrafts = atom('hideDrafts', false, { persist: 'plugin' })
export const query = atom('query', '')

/** The open pull request's key (`owner/name#number`); null shows the lists. */
export const selected = atom<string | null>(null)
export const detail = atom<PrDetail | null>(null)
export const detailError = atom<string | null>(null)
export const detailLoading = atom(false)
export const draft = atom('draft', '')
export const methodChoice = atom<MergeMethod | null>(null)
export const deleteChoice = atom<boolean | null>(null)

/** The file whose diff is open in the detail, and that diff. */
export const diffPath = atom<string | null>(null)
export const diffPatch = atom<{ text: string; truncated: boolean } | null>(null)
export const diffLoading = atom(false)
export const diffError = atom<string | null>(null)

export const candidates = atom<NewPrCandidate[] | null>(null)
export const candidatesLoading = atom(false)
export const candidatesError = atom<string | null>(null)

export const release = atom<Release | null>(null)
export const releaseLoading = atom(false)

/** What is running now ("Merging 1 of 2…"); buttons that write wait for it. */
export const busy = atom<string | null>(null)
export const notice = atom<{ tone: Tone; text: string } | null>(null)
export const pending = atom<Confirm | null>(null)

const errorText = (error: unknown): string => {
  const e = error as { message?: unknown; code?: unknown } | null
  return typeof e?.message === 'string' && e.message ? e.message : String(e?.code ?? error)
}

/** `be#12`. */
export const prName = (pr: Pick<PrSummary, 'repoLabel' | 'number'>): string => `${pr.repoLabel}#${pr.number}`

export function currentProjectId(): string | null {
  return read(choice) || read(focusedProjectId) || read(projects)[0]?.id || null
}

const listedProjectId = (): string | null => read(list)?.project?.id ?? currentProjectId()

export function allPrs(data: ProjectPrs | null = read(list)): PrSummary[] {
  return data?.repos.flatMap((r) => r.prs) ?? []
}

export async function loadProjects(): Promise<void> {
  try {
    const answer = await plugin.request('projects.list')
    set(projects, answer.projects)
    set(focusedProjectId, answer.focusedProjectId)
    // A project picked by hand that left Orca: follow the focus again.
    if (read(choice) && !answer.projects.some((p) => p.id === read(choice))) set(choice, '')
  } catch (error) {
    set(notice, { tone: 'danger', text: `Could not read Orca's projects: ${errorText(error)}` })
  }
}

let listRun = 0

export async function loadList(refresh = false): Promise<void> {
  const run = ++listRun
  set(listLoading, true)
  try {
    const data = await plugin.request('prs.list', { projectId: currentProjectId(), refresh }, { timeoutMs: 90_000 })
    if (run !== listRun) return
    set(list, data)
    // The status bar follows what the panel shows.
    if (data.project) void plugin.request('watch.set', { projectId: data.project.id }).catch(() => undefined)
  } catch (error) {
    if (run === listRun) set(notice, { tone: 'danger', text: `Could not list pull requests: ${errorText(error)}` })
  } finally {
    if (run === listRun) set(listLoading, false)
  }
}

export async function onFocusChanged(): Promise<void> {
  const before = read(focusedProjectId)
  await loadProjects()
  if (!read(choice) && read(focusedProjectId) !== before) {
    set(selected, null)
    set(candidates, null)
    set(release, null)
    await loadList()
    if (read(view) === 'release') void loadRelease()
  }
}

export function pickProject(id: string): void {
  set(choice, id)
  set(selected, null)
  set(candidates, null)
  set(release, null)
  set(notice, null)
  set(pending, null)
  void loadList()
  if (read(view) === 'new') void loadCandidates()
  if (read(view) === 'release') void loadRelease()
}

export function pickView(next: string): void {
  const value: View = next === 'repo' || next === 'new' || next === 'release' ? next : 'task'
  set(view, value)
  if (value === 'new') void loadCandidates()
  if (value === 'release') void loadRelease()
}

/** Fetches again what the panel shows when it is older than the refresh setting: called on a
 *  timer while the panel is in view, and right after it comes back into view. */
export function refreshIfStale(now = Date.now()): void {
  const data = read(list)
  const minutes = data?.defaults.refreshMinutes ?? 3
  if (!data || minutes <= 0 || read(busy) || read(listLoading)) return
  if (now - data.fetchedAt < minutes * 60_000) return
  void loadList()
  if (read(selected)) void loadDetail()
  if (read(view) === 'release' && !read(selected)) void loadRelease()
}

export async function loadDetail(): Promise<void> {
  const key = read(selected)
  const pr = allPrs().find((p) => p.key === key) ?? (read(detail)?.key === key ? read(detail) : null)
  if (!key || !pr) return
  set(detailLoading, true)
  try {
    const answer = await plugin.request('pr.detail', { repo: pr.repo, number: pr.number }, { timeoutMs: 60_000 })
    if (read(selected) !== key) return
    set(detail, answer.detail)
    set(detailError, answer.error)
  } catch (error) {
    if (read(selected) === key) set(detailError, errorText(error))
  } finally {
    if (read(selected) === key) set(detailLoading, false)
  }
}

export function openPr(key: string): void {
  set(selected, key)
  set(detail, null)
  set(detailError, null)
  set(draft, '')
  set(methodChoice, null)
  set(deleteChoice, null)
  set(diffPath, null)
  set(diffPatch, null)
  set(diffError, null)
  set(pending, null)
  set(notice, null)
  void loadDetail()
}

export function back(): void {
  set(selected, null)
  set(detail, null)
  set(diffPath, null)
  set(pending, null)
}

export async function openDiff(path: string | null): Promise<void> {
  const d = read(detail)
  set(diffPath, path)
  set(diffPatch, null)
  set(diffError, null)
  if (!path || !d) return
  set(diffLoading, true)
  try {
    const answer = await plugin.request('pr.diff', { repo: d.repo, number: d.number, sha: d.headSha, path }, { timeoutMs: 60_000 })
    if (read(diffPath) !== path) return
    set(diffPatch, answer.patch === null ? null : { text: answer.patch, truncated: answer.truncated })
    set(diffError, answer.error)
  } catch (error) {
    if (read(diffPath) === path) set(diffError, errorText(error))
  } finally {
    if (read(diffPath) === path) set(diffLoading, false)
  }
}

async function withBusy(label: string, work: () => Promise<void>): Promise<void> {
  if (read(busy)) return
  set(busy, label)
  set(notice, null)
  try {
    await work()
  } catch (error) {
    set(notice, { tone: 'danger', text: errorText(error) })
  } finally {
    set(busy, null)
  }
}

export function ask(confirm: Confirm): void {
  set(pending, confirm)
}

export async function confirmPending(): Promise<void> {
  const confirm = read(pending)
  set(pending, null)
  if (confirm) await confirm.run()
}

const BUSY: Record<PrAction, string> = {
  approve: 'Approving…',
  'request-changes': 'Requesting changes…',
  comment: 'Commenting…',
  merge: 'Merging…',
  'auto-merge': 'Turning on auto-merge…',
  'cancel-auto-merge': 'Turning off auto-merge…',
  ready: 'Marking ready…',
  draft: 'Converting to draft…',
  close: 'Closing…',
  reopen: 'Reopening…',
  'update-branch': 'Updating the branch…'
}

export function actOn(
  pr: PrSummary,
  action: PrAction,
  extra: { body?: string; method?: MergeMethod; deleteBranch?: boolean; sha?: string } = {}
): Promise<void> {
  return withBusy(BUSY[action], async () => {
    const result = await plugin.request(
      'pr.act',
      { repo: pr.repo, number: pr.number, action, ...extra },
      { timeoutMs: 120_000 }
    )
    set(notice, { tone: result.ok ? 'success' : 'danger', text: result.message })
    if (!result.ok) return
    if (action === 'comment' || action === 'approve' || action === 'request-changes') set(draft, '')
    if (read(selected) === pr.key) await loadDetail()
  })
}

/** Merges the pull requests one request at a time, in the order given, saying which one is
 *  going, and stops at the first that fails. One request each keeps every merge well inside
 *  a request's time limit. */
export async function mergeInOrder(label: string, prs: readonly PrSummary[], method: MergeMethod, deleteBranch: boolean): Promise<void> {
  if (read(busy) || prs.length === 0) return
  set(notice, null)
  const done: string[] = []
  try {
    for (const [i, pr] of prs.entries()) {
      set(busy, `Merging ${i + 1} of ${prs.length}: ${prName(pr)}…`)
      const result = await plugin.request(
        'pr.act',
        { repo: pr.repo, number: pr.number, action: 'merge', method, deleteBranch, sha: pr.headSha },
        { timeoutMs: 120_000 }
      )
      if (!result.ok) {
        const left = prs.slice(i + 1).map(prName)
        set(notice, {
          tone: done.length ? 'warning' : 'danger',
          text: `${label}: ${[...done, result.message].join('; ')}${left.length ? `. Not merged: ${left.join(', ')}` : ''}`
        })
        return
      }
      done.push(result.message)
    }
    set(notice, { tone: 'success', text: `${label}: ${done.join('; ')}` })
  } catch (error) {
    set(notice, { tone: 'danger', text: `${label}: ${[...done, errorText(error)].join('; ')}` })
  } finally {
    set(busy, null)
  }
}

/** Switches each repo to its branch (a task's head, or back to the base). */
export function checkout(items: readonly { repo: string; branch: string }[], label: string): Promise<void> {
  return withBusy(label, async () => {
    const answer = await plugin.request(
      'task.checkout',
      { projectId: listedProjectId(), items: items.map((i) => ({ repo: i.repo, branch: i.branch })) },
      { timeoutMs: 120_000 }
    )
    const failed = answer.results.filter((r) => !r.ok).length
    set(notice, {
      tone: failed === 0 ? 'success' : failed < answer.results.length ? 'warning' : 'danger',
      text: answer.results.map((r) => r.message).join('; ')
    })
  })
}

export function reviewWithAgent(prs: readonly PrSummary[]): Promise<void> {
  return withBusy('Starting the agent…', async () => {
    const result = await plugin.request('agent.review', {
      projectId: listedProjectId(),
      prs: prs.map((pr) => ({ repo: pr.repo, number: pr.number }))
    })
    set(notice, { tone: result.ok ? 'success' : 'danger', text: result.message })
  })
}

export async function loadCandidates(): Promise<void> {
  set(candidatesLoading, true)
  try {
    const answer = await plugin.request('pr.candidates', { projectId: currentProjectId() }, { timeoutMs: 90_000 })
    set(candidates, answer.candidates)
    set(candidatesError, answer.error)
  } catch (error) {
    set(candidatesError, errorText(error))
  } finally {
    set(candidatesLoading, false)
  }
}

export function createPrs(items: readonly NewPrCandidate[], asDraft: boolean): Promise<void> {
  return withBusy(items.length > 1 ? `Opening ${items.length} pull requests…` : 'Opening the pull request…', async () => {
    const messages: string[] = []
    let failed = 0
    for (const item of items) {
      const result = await plugin.request(
        'pr.create',
        { projectId: listedProjectId(), repoPath: item.repo.path, base: item.base, draft: asDraft },
        { timeoutMs: 120_000 }
      )
      messages.push(result.url ? `${result.message}: ${result.url}` : result.message)
      if (!result.ok) failed++
    }
    set(notice, { tone: failed === 0 ? 'success' : failed < items.length ? 'warning' : 'danger', text: messages.join('\n') })
    await loadCandidates()
  })
}

export async function loadRelease(): Promise<void> {
  set(releaseLoading, true)
  try {
    set(release, await plugin.request('release.status', { projectId: currentProjectId() }, { timeoutMs: 90_000 }))
  } catch (error) {
    set(release, { head: '', base: '', repos: [], error: errorText(error) })
  } finally {
    set(releaseLoading, false)
  }
}

export function openReleases(repos: readonly ReleaseRepo[]): Promise<void> {
  return withBusy(repos.length > 1 ? `Opening ${repos.length} release pull requests…` : 'Opening the release pull request…', async () => {
    const messages: string[] = []
    let failed = 0
    for (const r of repos) {
      if (!r.repo.slug) continue
      const result = await plugin.request('release.open', { projectId: listedProjectId(), repo: r.repo.slug }, { timeoutMs: 90_000 })
      messages.push(result.url ? `${result.message}: ${result.url}` : result.message)
      if (!result.ok) failed++
    }
    set(notice, { tone: failed === 0 ? 'success' : failed < repos.length ? 'warning' : 'danger', text: messages.join('\n') })
    await loadRelease()
  })
}
