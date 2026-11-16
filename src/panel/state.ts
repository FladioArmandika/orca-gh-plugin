// The panel's state (atoms) and everything that talks to the worker.
import { atom, plugin, read, set, type Tone } from 'orca'
import type { MergeMethod, NewPrCandidate, PrAction, PrDetail, PrSummary, ProjectInfo, ProjectPrs } from '../protocol'
import type { PrFilter, PrGroup } from '../shared/group'

export type View = 'task' | 'repo' | 'new'
export type Confirm = { title: string; body: string; label: string; tone: Tone; run: () => Promise<void> }

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

export const candidates = atom<NewPrCandidate[] | null>(null)
export const candidatesLoading = atom(false)
export const candidatesError = atom<string | null>(null)

/** What is running now ("Merging…"); buttons that write wait for it. */
export const busy = atom<string | null>(null)
export const notice = atom<{ tone: Tone; text: string } | null>(null)
export const pending = atom<Confirm | null>(null)

const errorText = (error: unknown): string => {
  const e = error as { message?: unknown; code?: unknown } | null
  return typeof e?.message === 'string' && e.message ? e.message : String(e?.code ?? error)
}

export function currentProjectId(): string | null {
  return read(choice) || read(focusedProjectId) || read(projects)[0]?.id || null
}

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
    if (run === listRun) set(list, data)
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
    await loadList()
  }
}

export function pickProject(id: string): void {
  set(choice, id)
  set(selected, null)
  set(candidates, null)
  set(notice, null)
  set(pending, null)
  void loadList()
  if (read(view) === 'new') void loadCandidates()
}

export function pickView(next: string): void {
  const value: View = next === 'repo' || next === 'new' ? next : 'task'
  set(view, value)
  if (value === 'new') void loadCandidates()
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
  set(pending, null)
  set(notice, null)
  void loadDetail()
}

export function back(): void {
  set(selected, null)
  set(detail, null)
  set(pending, null)
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

export function mergeGroup(group: PrGroup, prs: readonly PrSummary[], method: MergeMethod, deleteBranch: boolean): Promise<void> {
  return withBusy(`Merging ${prs.length} pull requests…`, async () => {
    const answer = await plugin.request(
      'group.merge',
      { prs: prs.map((pr) => ({ repo: pr.repo, number: pr.number, sha: pr.headSha, waitsFor: pr.waitsFor })), method, deleteBranch },
      { timeoutMs: 120_000 }
    )
    const failed = answer.results.some((r) => !r.ok)
    set(notice, {
      tone: failed ? (answer.results.some((r) => r.ok) ? 'warning' : 'danger') : 'success',
      text: `${group.label}: ${answer.results.map((r) => r.message).join('; ')}`
    })
  })
}

export function reviewWithAgent(prs: readonly PrSummary[]): Promise<void> {
  return withBusy('Starting the agent…', async () => {
    const result = await plugin.request('agent.review', {
      projectId: read(list)?.project?.id ?? currentProjectId(),
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
        { projectId: read(list)?.project?.id ?? currentProjectId(), repoPath: item.repo.path, base: item.base, draft: asDraft },
        { timeoutMs: 120_000 }
      )
      messages.push(result.url ? `${result.message}: ${result.url}` : result.message)
      if (!result.ok) failed++
    }
    set(notice, { tone: failed === 0 ? 'success' : failed < items.length ? 'warning' : 'danger', text: messages.join('\n') })
    await loadCandidates()
  })
}
