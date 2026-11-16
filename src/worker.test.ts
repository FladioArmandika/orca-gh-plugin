// The worker against a real folder of fake repos, with git and gh answered by a stand-in.
import { afterEach, assert, beforeEach, mockHost, mountWorker, test } from 'orca/testing'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { setRunner, type Run } from './worker/exec'
import * as main from './worker'

let root = ''
let calls: string[][] = []

const ok = (stdout: string) => ({ code: 0, stdout, stderr: '' })
const rawPr = (repo: string, number: number, head: string) => ({
  number,
  title: `change ${number}`,
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
  reviewRequests: []
})
const PRS: Record<string, unknown[]> = {
  'acme/shop-be': [rawPr('shop-be', 77, 'feat/42-gift-cards')],
  'acme/shop-fe': [rawPr('shop-fe', 31, 'feat/42-gift-cards')],
  'acme/shop-admin': []
}

const fake: Run = async (cmd, args) => {
  calls.push([cmd, ...args])
  if (cmd === 'git') {
    const [, path, ...rest] = args
    const line = rest.join(' ')
    if (line === 'remote') return ok('origin\n')
    if (line === 'remote get-url origin') return ok(`git@github.com-work:acme/${basename(path)}.git\n`)
    if (line === 'rev-parse --abbrev-ref HEAD') return ok('development\n')
  }
  if (cmd === 'gh') {
    if (args[0] === 'api') return ok('octo\n')
    if (args[0] === 'repo') return ok('development\n')
    if (args[0] === 'pr' && args[1] === 'list') return ok(JSON.stringify(PRS[args[3]] ?? []))
    if (args[0] === 'pr' && args[1] === 'view') {
      const number = Number(args[2])
      return ok(JSON.stringify({ headRefName: 'feat/42-gift-cards', headRefOid: `sha-${number}`, state: 'OPEN' }))
    }
    if (args[0] === 'pr' && args[1] === 'merge') return ok('')
  }
  return { code: 1, stdout: '', stderr: `unexpected: ${cmd} ${args.join(' ')}` }
}

function host() {
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
      'agent.launch': { terminalId: 't1' }
    },
    settings: { mergeOrder: 'be', deleteBranch: true, reviewAgent: 'codex' }
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'project-prs-worker-'))
  for (const name of ['shop-admin', 'shop-be', 'shop-fe']) await mkdir(join(root, name, '.git'), { recursive: true })
  calls = []
  setRunner(fake)
})

afterEach(async () => {
  setRunner(null)
  await rm(root, { recursive: true, force: true })
})

test('lists local projects and the focused one', async () => {
  const worker = await mountWorker(main, { host: host() })
  const answer = await worker.request('projects.list')
  assert.deepEqual(answer.projects.map((p) => p.id), ['p1'], 'projects on another host are left out')
  assert.equal(answer.focusedProjectId, 'p1')
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('lists every repo of the focused project, and caches it', async () => {
  const worker = await mountWorker(main, { host: host() })
  const list = await worker.request('prs.list', { projectId: null })
  assert.equal(list.error, null)
  assert.equal(list.viewer, 'octo')
  assert.deepEqual(list.repos.map((r) => [r.repo.name, r.repo.slug, r.prs.length]), [
    ['shop-admin', 'acme/shop-admin', 0],
    ['shop-be', 'acme/shop-be', 1],
    ['shop-fe', 'acme/shop-fe', 1]
  ])
  assert.equal(list.repos[1].prs[0].mine, true)
  const listed = calls.filter((c) => c[0] === 'gh' && c[2] === 'list').length
  await worker.request('prs.list', { projectId: 'p1' })
  assert.equal(calls.filter((c) => c[0] === 'gh' && c[2] === 'list').length, listed, 'the second ask is cached')
  await worker.request('prs.list', { projectId: 'p1', refresh: true })
  assert.equal(calls.filter((c) => c[0] === 'gh' && c[2] === 'list').length, listed * 2)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('merges a task backend first, guarded by head commit, and tells panels', async () => {
  const worker = await mountWorker(main, { host: host() })
  await worker.request('prs.list', { projectId: null })
  const answer = await worker.request('group.merge', {
    prs: [
      { repo: 'acme/shop-fe', number: 31, sha: 'sha-31' },
      { repo: 'acme/shop-be', number: 77, sha: 'sha-77' }
    ],
    method: 'squash',
    deleteBranch: true
  })
  assert.deepEqual(answer.results.map((r) => [r.key, r.ok]), [
    ['acme/shop-be#77', true],
    ['acme/shop-fe#31', true]
  ])
  const merges = calls.filter((c) => c[0] === 'gh' && c[2] === 'merge')
  assert.deepEqual(merges[0], [
    'gh', 'pr', 'merge', '77', '-R', 'acme/shop-be', '--squash', '--match-head-commit', 'sha-77', '--delete-branch'
  ])
  assert.deepEqual(worker.posts.at(-1), { event: 'prs.changed', payload: { repos: ['acme/shop-be', 'acme/shop-fe'] } })
  await worker.deactivate()
})

test('stops a group merge at the first failure', async () => {
  const worker = await mountWorker(main, { host: host() })
  const answer = await worker.request('group.merge', {
    prs: [
      { repo: 'acme/shop-be', number: 77, sha: 'stale' },
      { repo: 'acme/shop-fe', number: 31, sha: 'sha-31' }
    ]
  })
  assert.deepEqual(answer.results.map((r) => r.ok), [false, false])
  assert.match(answer.results[0].message, /new commits/)
  assert.match(answer.results[1].message, /earlier merge failed/)
  assert.equal(calls.filter((c) => c[0] === 'gh' && c[2] === 'merge').length, 0)
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
  assert.deepEqual(worker.refusals, [])
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

test('asks for a review agent before starting one', async () => {
  const h = mockHost({
    results: {
      'project.list': { projects: [{ id: 'p1', name: 'shop', kind: 'folder', hostId: 'local', path: root }], truncated: false },
      'workspace.list': { workspaces: [], truncated: false },
      'workspace.readContext': null
    }
  })
  const worker = await mountWorker(main, { host: h })
  const result = await worker.request('agent.review', { projectId: 'p1', prs: [{ repo: 'acme/shop-be', number: 77 }] })
  assert.equal(result.ok, false)
  assert.match(result.message, /Settings/)
  assert.equal(h.callsOf('agent.launch').length, 0)
  await worker.deactivate()
})
