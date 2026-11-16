// The worker against a real folder of fake repos, with git and gh answered by a stand-in.
import { afterEach, assert, beforeEach, mockHost, mountWorker, test } from 'orca/testing'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { setRunner, type Run } from './worker/exec'
import * as main from './worker'

let root = ''
let calls: string[][] = []
let dirty = new Set<string>()
let PRS: Record<string, unknown[]> = {}

const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' })
const failedCheck = (job: string) => ({
  __typename: 'CheckRun',
  name: `check-${job}`,
  status: 'COMPLETED',
  conclusion: 'FAILURE',
  detailsUrl: `https://github.com/acme/shop-be/actions/runs/1/job/${job}`
})
const rawPr = (repo: string, number: number, head: string, body = '', over: Record<string, unknown> = {}) => ({
  body,
  number,
  title: `feat(cards): change ${number} (42)`,
  url: `https://github.com/acme/${repo}/pull/${number}`,
  author: { login: 'octo' },
  headRefName: head,
  headRefOid: `sha-${number}`,
  baseRefName: 'development',
  isDraft: false,
  reviewDecision: 'APPROVED',
  mergeStateStatus: 'CLEAN',
  mergeable: 'MERGEABLE',
  statusCheckRollup: [],
  updatedAt: '2026-11-15T10:00:00Z',
  labels: [],
  reviewRequests: [],
  autoMergeRequest: null,
  ...over
})

function seed() {
  PRS = {
    'acme/shop-be': [
      rawPr('shop-be', 77, 'feat/42-gift-cards', '**Task:** [Gift cards at checkout (Tasks 42)](https://tasks.example.com/42)', {
        statusCheckRollup: [failedCheck('900'), failedCheck('901')]
      })
    ],
    'acme/shop-fe': [
      rawPr('shop-fe', 31, 'feat/42-gift-cards', '**Pairs with:** shop-be (merge the backend first, after be#77)'),
      rawPr('shop-fe', 32, 'fix/7-typo', 'Fixes fe#20. Merge after be#999.', { title: 'fix: typo' })
    ],
    'acme/shop-admin': []
  }
}

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  'diff --git a/src/b.ts b/src/b.ts',
  '+b'
].join('\n')

const fake: Run = async (cmd, args) => {
  calls.push([cmd, ...args])
  if (cmd === 'git') {
    const [, path, ...rest] = args
    const line = rest.join(' ')
    if (line === 'remote') return ok('origin\n')
    if (line === 'remote get-url origin') return ok(`git@github.com-work:acme/${basename(path)}.git\n`)
    if (line === 'rev-parse --abbrev-ref HEAD') return ok('development\n')
    if (line === 'status --porcelain') return ok(dirty.has(basename(path)) ? ' M src/a.ts\n' : '')
    if (rest[0] === 'fetch' || rest[0] === 'switch' || rest[0] === 'merge') return ok('')
    if (rest[0] === 'rev-parse' && rest.includes('--verify')) return { code: 1, stdout: '', stderr: '' }
  }
  if (cmd === 'gh') {
    if (args[0] === 'api' && args[1] === 'user') return ok('octo\n')
    if (args[0] === 'api' && args[1].includes('/check-runs/900/')) {
      return ok('The job was not started because your spending limit needs to be increased. Please check billing.\n')
    }
    if (args[0] === 'api' && args[1].includes('/check-runs/')) return ok('Process completed with exit code 1.\n')
    if (args[0] === 'api' && args[1].includes('/compare/')) {
      return ok(JSON.stringify({ ahead: 2, behind: 0, commits: ['feat: older', 'fix: newer'] }))
    }
    if (args[0] === 'repo') return ok('main\n')
    if (args[0] === 'pr' && args[1] === 'list') return ok(JSON.stringify(PRS[args[3]] ?? []))
    if (args[0] === 'pr' && args[1] === 'view' && String(args.at(-1)).includes('files')) {
      const raw = (PRS[args[4]] as { number: number }[]).find((p) => p.number === Number(args[2]))
      return ok(JSON.stringify({ ...raw, state: 'OPEN', files: [], reviews: [], comments: [] }))
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      const number = Number(args[2])
      return ok(JSON.stringify({ headRefName: 'feat/42-gift-cards', headRefOid: `sha-${number}`, state: 'OPEN' }))
    }
    if (args[0] === 'pr' && args[1] === 'merge') return ok('')
    if (args[0] === 'pr' && args[1] === 'diff') return ok(DIFF)
    if (args[0] === 'pr' && args[1] === 'create') return ok('https://github.com/acme/shop-be/pull/100\n')
  }
  return { code: 1, stdout: '', stderr: `unexpected: ${cmd} ${args.join(' ')}` }
}

function host(settings: Record<string, unknown> = {}) {
  return mockHost({
    results: {
      'project.list': {
        projects: [
          { id: 'p1', name: 'shop', kind: 'folder', hostId: 'local', path: root },
          { id: 'p2', name: 'remote', kind: 'git', hostId: 'ssh:box', path: '/srv/x' }
        ],
        truncated: false
      },
      'workspace.list': {
        workspaces: [{ id: 'w1', kind: 'folder', name: 'shop', projectId: 'p1', path: root, branch: null, hostId: null }],
        truncated: false
      },
      'workspace.readContext': { workspaceId: 'w1', branch: '', displayName: 'shop', terminals: [] },
      'agent.launch': { terminalId: 't1' },
      'statusBar.update': { ok: true },
      'notifications.show': { delivered: true }
    },
    settings: { mergeOrder: 'be', deleteBranch: true, reviewAgent: 'codex', ...settings }
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'project-prs-worker-'))
  for (const name of ['shop-admin', 'shop-be', 'shop-fe']) await mkdir(join(root, name, '.git'), { recursive: true })
  calls = []
  dirty = new Set()
  seed()
  setRunner(fake)
})

afterEach(async () => {
  setRunner(null)
  await rm(root, { recursive: true, force: true })
})

const ghCalls = (sub: string) => calls.filter((c) => c[0] === 'gh' && c[2] === sub)

test('lists local projects and the focused one', async () => {
  const worker = await mountWorker(main, { host: host() })
  const answer = await worker.request('projects.list')
  assert.deepEqual(answer.projects.map((p) => p.id), ['p1'], 'projects on another host are left out')
  assert.equal(answer.focusedProjectId, 'p1')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('lists every repo of the focused project with short names, tasks and dependencies', async () => {
  const worker = await mountWorker(main, { host: host() })
  const list = await worker.request('prs.list', { projectId: null })
  assert.equal(list.error, null)
  assert.deepEqual(list.repos.map((r) => [r.repo.short, r.repo.slug, r.prs.length]), [
    ['admin', 'acme/shop-admin', 0],
    ['be', 'acme/shop-be', 1],
    ['fe', 'acme/shop-fe', 2]
  ])
  const be = list.repos[1].prs[0]
  assert.equal(be.repoLabel, 'be')
  assert.equal(be.headline, 'Change 77')
  assert.equal(be.kind, 'feat(cards)')
  assert.deepEqual([be.taskTitle, be.taskUrl], ['Gift cards at checkout', 'https://tasks.example.com/42'])
  assert.deepEqual(list.repos[2].prs.map((pr) => pr.waitsFor), [['acme/shop-be#77'], []], 'only open pull requests of the project count')
  assert.equal('deps' in be || 'failedJobs' in be, false, 'worker-only fields stay in the worker')
  const listed = ghCalls('list').length
  await worker.request('prs.list', { projectId: 'p1' })
  assert.equal(ghCalls('list').length, listed, 'the second ask is cached')
  await worker.request('prs.list', { projectId: 'p1', refresh: true })
  assert.equal(ghCalls('list').length, listed * 2)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('tells checks that never started apart from real failures, asking GitHub once', async () => {
  const worker = await mountWorker(main, { host: host() })
  const list = await worker.request('prs.list', { projectId: null })
  const be = list.repos[1].prs[0]
  assert.deepEqual([be.checks.failed, be.checks.notRun], [1, 1])
  assert.equal(list.ciNote, 'The job was not started because your spending limit needs to be increased.')
  const asked = calls.filter((c) => c[0] === 'gh' && String(c[2]).includes('/check-runs/')).length
  assert.equal(asked, 2)
  await worker.request('prs.list', { projectId: null, refresh: true })
  assert.equal(calls.filter((c) => c[0] === 'gh' && String(c[2]).includes('/check-runs/')).length, asked, 'answers are kept')
  const detail = await worker.request('pr.detail', { repo: 'acme/shop-be', number: 77 })
  assert.deepEqual(detail.detail?.checkRuns.map((r) => [r.name, r.state, r.note]), [
    ['check-900', 'not-run', 'The job was not started because your spending limit needs to be increased.'],
    ['check-901', 'failed', null]
  ])
  assert.deepEqual([detail.detail?.checks.failed, detail.detail?.checks.notRun], [1, 1])
  await worker.deactivate()
})

test('merges at the listed head commit, and refuses one that moved', async () => {
  const worker = await mountWorker(main, { host: host() })
  await worker.request('prs.list', { projectId: null })
  const merged = await worker.request('pr.act', { repo: 'acme/shop-be', number: 77, action: 'merge', method: 'squash', deleteBranch: true, sha: 'sha-77' })
  assert.equal(merged.ok, true)
  assert.deepEqual(ghCalls('merge')[0], [
    'gh', 'pr', 'merge', '77', '-R', 'acme/shop-be', '--squash', '--match-head-commit', 'sha-77', '--delete-branch'
  ])
  assert.deepEqual(worker.posts.at(-1), { event: 'prs.changed', payload: { repos: ['acme/shop-be'] } })
  const stale = await worker.request('pr.act', { repo: 'acme/shop-fe', number: 31, action: 'merge', sha: 'old' })
  assert.equal(stale.ok, false)
  assert.match(stale.message, /new commits/)
  const auto = await worker.request('pr.act', { repo: 'acme/shop-fe', number: 31, action: 'auto-merge', method: 'squash', sha: 'sha-31' })
  assert.equal(auto.ok, true)
  assert.deepEqual(ghCalls('merge').at(-1), ['gh', 'pr', 'merge', '31', '-R', 'acme/shop-fe', '--auto', '--squash', '--match-head-commit', 'sha-31'])
  assert.match(auto.message, /once its checks pass/)
  await worker.deactivate()
})

test('checks a task out in each repo, leaving one with uncommitted changes alone', async () => {
  dirty.add('shop-fe')
  const worker = await mountWorker(main, { host: host() })
  const answer = await worker.request('task.checkout', {
    projectId: 'p1',
    items: [
      { repo: 'acme/shop-be', branch: 'feat/42-gift-cards' },
      { repo: 'acme/shop-fe', branch: 'feat/42-gift-cards' },
      { repo: 'acme/shop-be', branch: '--upload-pack=x' }
    ]
  })
  assert.deepEqual(answer.results.map((r) => [r.ok, r.message]), [
    [true, 'be: on feat/42-gift-cards'],
    [false, 'fe: has uncommitted changes, left on its branch'],
    [false, 'be: bad branch name']
  ])
  const be = calls.filter((c) => c[0] === 'git' && c[2].endsWith('shop-be')).map((c) => c.slice(3).join(' '))
  assert.ok(be.includes('fetch origin refs/heads/feat/42-gift-cards:refs/remotes/origin/feat/42-gift-cards'))
  assert.ok(be.includes('switch --track -c feat/42-gift-cards origin/feat/42-gift-cards'))
  assert.equal(calls.filter((c) => c[0] === 'git' && c[2].endsWith('shop-fe') && c[3] === 'switch').length, 0)
  await worker.deactivate()
})

test('compares releases and opens one with its commits', async () => {
  const worker = await mountWorker(main, { host: host() })
  const status = await worker.request('release.status', { projectId: 'p1' })
  assert.deepEqual([status.head, status.base], ['development', 'main'])
  assert.deepEqual(status.repos.map((r) => [r.repo.short, r.ahead, r.commits[0]]), [
    ['admin', 2, 'fix: newer'],
    ['be', 2, 'fix: newer'],
    ['fe', 2, 'fix: newer']
  ])
  const opened = await worker.request('release.open', { projectId: 'p1', repo: 'acme/shop-be' })
  assert.equal(opened.url, 'https://github.com/acme/shop-be/pull/100')
  const create = ghCalls('create')[0]
  assert.deepEqual(create.slice(3, 9), ['-R', 'acme/shop-be', '--base', 'main', '--head', 'development'])
  assert.match(create[10], /^Release development to main \(\d{4}-\d{2}-\d{2}\)$/)
  assert.equal(create[12], 'Merges development into main.\n\n- fix: newer\n- feat: older')
  await worker.deactivate()
})

test('answers one file of a diff, fetching the whole diff once', async () => {
  const worker = await mountWorker(main, { host: host() })
  const a = await worker.request('pr.diff', { repo: 'acme/shop-be', number: 77, sha: 'sha-77', path: 'src/a.ts' })
  assert.match(a.patch ?? '', /^diff --git a\/src\/a.ts b\/src\/a.ts[\s\S]*\+new$/)
  const b = await worker.request('pr.diff', { repo: 'acme/shop-be', number: 77, sha: 'sha-77', path: 'src/b.ts' })
  assert.equal(b.patch, 'diff --git a/src/b.ts b/src/b.ts\n+b')
  assert.equal(ghCalls('diff').length, 1)
  const missing = await worker.request('pr.diff', { repo: 'acme/shop-be', number: 77, sha: 'sha-77', path: 'nope' })
  assert.equal(missing.patch, null)
  await worker.deactivate()
})

test('keeps the status bar current and notifies what changed', async () => {
  const h = host()
  const worker = await mountWorker(main, { host: h })
  await worker.request('watch.set', { projectId: 'p1' })
  await worker.command('project-prs.refresh')
  const status = h.callsOf('statusBar.update').at(-1) as { text: string; visible: boolean }
  assert.equal(status.visible, true)
  assert.match(status.text, /^3 PRs/)
  assert.equal(h.callsOf('notifications.show').length, 0, 'the first look only sets the baseline')
  ;(PRS['acme/shop-fe'][1] as { reviewRequests: unknown[] }).reviewRequests = [{ __typename: 'User', login: 'octo' }]
  await worker.command('project-prs.refresh')
  const notes = h.callsOf('notifications.show') as { title: string }[]
  assert.deepEqual(notes.map((n) => n.title), ['Review requested: fe#32'])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('starts the review agent in a workspace of the project', async () => {
  const h = host()
  const worker = await mountWorker(main, { host: h })
  await worker.request('prs.list', { projectId: null })
  const result = await worker.request('agent.review', {
    projectId: 'p1',
    prs: [
      { repo: 'acme/shop-be', number: 77 },
      { repo: 'acme/shop-fe', number: 31 }
    ]
  })
  assert.equal(result.ok, true)
  const launch = h.callsOf('agent.launch')[0] as { workspaceId: string; agent: string; prompt: string }
  assert.equal(launch.workspaceId, 'w1')
  assert.equal(launch.agent, 'codex')
  assert.match(launch.prompt, /acme\/shop-be#77 \(local clone: .*shop-be\)/)
  assert.match(launch.prompt, /Do not push, merge, approve/)
  await worker.deactivate()
})

test('asks for a review agent before starting one', async () => {
  const h = host({ reviewAgent: '' })
  const worker = await mountWorker(main, { host: h })
  const result = await worker.request('agent.review', { projectId: 'p1', prs: [{ repo: 'acme/shop-be', number: 77 }] })
  assert.equal(result.ok, false)
  assert.match(result.message, /Settings/)
  assert.equal(h.callsOf('agent.launch').length, 0)
  await worker.deactivate()
})

test('refuses to open a pull request in a folder it never found', async () => {
  const worker = await mountWorker(main, { host: host() })
  const result = await worker.request('pr.create', { projectId: 'p1', repoPath: '/etc', base: 'main' })
  assert.equal(result.ok, false)
  assert.equal(calls.filter((c) => c[0] === 'git' && c.includes('push')).length, 0)
  await worker.deactivate()
})

test('new pull requests go where the project\'s feature PRs go, not to a release', () => {
  const keep = ['main', 'development']
  assert.equal(
    main.usualBase(
      [
        { head: 'feat/1-a', base: 'development' },
        { head: 'fix/2-b', base: 'development' },
        { head: 'development', base: 'main' },
        { head: 'hotfix/3', base: 'main' }
      ],
      keep
    ),
    'development'
  )
  assert.equal(main.usualBase([{ head: 'development', base: 'main' }], keep), null)
})
