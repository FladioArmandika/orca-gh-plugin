// The panel with the worker stood in for: what each plugin.request answers.
import { afterEach, assert, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panel from './panel'
import { refreshIfStale } from './panel/state'
import { bePr, detailOf, fePr, lonePr, neverRan, pr, projectPrs, repos } from './test/fixtures'

let view: TestPanel | undefined
afterEach(() => view?.unmount())

type Log = { name: string; input: any }[]

function stubs(log: Log = [], data = projectPrs(), over: Record<string, (input: any) => unknown> = {}) {
  const record =
    (name: string, answer: (input: any) => unknown) =>
    (input: unknown) => {
      log.push({ name, input })
      return answer(input)
    }
  const answers: Record<string, (input: any) => unknown> = {
    'projects.list': () => ({ projects: [{ id: 'p1', name: 'shop', kind: 'folder', path: '/work/shop' }], focusedProjectId: 'p1' }),
    'prs.list': () => data,
    'pr.detail': ({ repo, number }) => ({ detail: detailOf(repo === bePr.repo && number === bePr.number ? bePr : fePr), error: null }),
    'pr.act': ({ repo, number, action }) => ({ ok: true, message: `${action} ${repo.split('/')[1]}#${number}` }),
    'pr.diff': () => ({ patch: 'diff --git a/src/cards/gift.ts b/src/cards/gift.ts\n+gift', truncated: false, error: null }),
    'agent.review': () => ({ ok: true, message: 'Started codex in shop' }),
    'task.checkout': ({ items }) => ({ results: items.map((i: { branch: string }) => ({ ok: true, message: `on ${i.branch}` })) }),
    'release.status': () => ({
      head: 'development',
      base: 'main',
      repos: [
        { repo: repos[0], ahead: 3, behind: 0, commits: ['feat: one', 'fix: two', 'chore: three'], pr: null, error: null },
        { repo: repos[1], ahead: 0, behind: 0, commits: [], pr: null, error: null },
        {
          repo: repos[2],
          ahead: 1,
          behind: 0,
          commits: ['fix: four'],
          pr: pr({ repo: 'acme/shop-admin', number: 50, head: 'development', base: 'main', title: 'Release development to main', task: null }),
          error: null
        }
      ],
      error: null
    }),
    'release.open': ({ repo }) => ({ ok: true, message: `Opened the release pull request of ${repo}`, url: null }),
    'watch.set': () => ({ ok: true }),
    ...over
  }
  return mockHost({
    capabilities: ['workspace:read', 'settings:own', 'agent:launch'],
    requests: Object.fromEntries(Object.entries(answers).map(([name, answer]) => [name, record(name, answer)]))
  })
}

const calls = (log: Log, name: string) => log.filter((l) => l.name === name)

test('groups the task across repos under its name, with short repo names', async () => {
  view = await mount(panel, { host: stubs() })
  assert.ok(view.find({ type: 'Card', label: 'Task 42 · Gift cards at checkout' }), 'the task card carries the task name')
  assert.equal(view.find({ type: 'Card', label: 'Task 42 · Gift cards at checkout' })?.props.description, 'feat/42-gift-cards · merge order: be → fe')
  assert.ok(view.find({ text: 'Across repos (1)' }))
  assert.ok(view.find({ text: '3 open' }))
  assert.ok(view.find({ text: '1 to review' }))
  assert.ok(view.find({ text: /Gift cards at checkout\s*be#77 · feat\(cards\) · octo/ }), 'rows in a card leave the branch out')
  assert.ok(view.find({ role: 'button', text: 'Task' }), 'the task opens from its card')
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('merges a whole task one pull request at a time, backend first', async () => {
  const log: Log = []
  view = await mount(panel, { host: stubs(log) })
  await view.press({ role: 'button', text: 'Merge 2 in order' })
  assert.ok(view.find({ label: 'Merge Task 42?' }), 'asks first')
  assert.equal(calls(log, 'pr.act').length, 0)
  await view.press({ role: 'button', text: 'Merge 2' })
  assert.deepEqual(
    calls(log, 'pr.act').map((c) => [c.input.repo, c.input.action, c.input.sha]),
    [
      ['acme/shop-be', 'merge', 'sha-77'],
      ['acme/shop-fe', 'merge', 'sha-31']
    ]
  )
  assert.ok(view.find({ text: 'Task 42: merge shop-be#77; merge shop-fe#31' }))
  assert.deepEqual(view.errors, [])
})

test('stops a task merge at the first failure and names what is left', async () => {
  const log: Log = []
  view = await mount(panel, {
    host: stubs(log, projectPrs(), { 'pr.act': () => ({ ok: false, message: 'be#77: checks are failing' }) })
  })
  await view.press({ role: 'button', text: 'Merge 2 in order' })
  await view.press({ role: 'button', text: 'Merge 2' })
  assert.equal(calls(log, 'pr.act').length, 1)
  assert.ok(view.find({ text: 'Task 42: be#77: checks are failing. Not merged: fe#31' }))
})

test('filters to what needs my review', async () => {
  view = await mount(panel, { host: stubs() })
  await view.select({ label: 'Show' }, 'review')
  assert.equal(view.find({ type: 'Card', label: 'Task 42 · Gift cards at checkout' }), null, 'one PR left: no cross-repo card')
  assert.ok(view.find({ text: /fe#31 · feat\(cards\)/ }))
  assert.equal(view.find({ text: /be#77/ }), null)
})

test('opens a pull request, shows a file diff, and merges with the head commit', async () => {
  const log: Log = []
  view = await mount(panel, { host: stubs(log) })
  await view.select({ label: 'View' }, 'repo')
  await view.press({ text: /#77 · feat\(cards\)/ })
  assert.ok(view.find({ role: 'heading', text: 'Gift cards at checkout' }))
  assert.ok(view.find({ type: 'Card', label: 'Same task in other repos' }), 'shows the fe PR of the same task')
  await view.toggle({ label: 'Files (2)' })
  await view.selectRows({ label: 'Changed files' }, ['src/cards/gift.ts'])
  assert.deepEqual(calls(log, 'pr.diff')[0]?.input, { repo: 'acme/shop-be', number: 77, sha: 'sha-77', path: 'src/cards/gift.ts' })
  assert.ok(view.find({ type: 'CodeView' }), 'the diff shows')
  await view.press({ role: 'button', text: 'Merge' })
  await view.press({ role: 'button', text: 'Merge' })
  assert.deepEqual(calls(log, 'pr.act')[0]?.input, {
    repo: 'acme/shop-be',
    number: 77,
    action: 'merge',
    method: 'squash',
    deleteBranch: true,
    sha: 'sha-77'
  })
  await view.press({ text: '← All pull requests' })
  assert.ok(view.find({ label: 'be (1)' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('turns on auto-merge after confirming', async () => {
  const log: Log = []
  view = await mount(panel, { host: stubs(log) })
  await view.select({ label: 'View' }, 'repo')
  await view.press({ text: /#77 · feat\(cards\)/ })
  await view.press({ role: 'button', text: 'Merge when green' })
  await view.press({ role: 'button', text: 'Turn on auto-merge' })
  assert.equal(calls(log, 'pr.act')[0]?.input.action, 'auto-merge')
})

test('holds a task whose pull request waits for one outside it', async () => {
  const waiting = { ...fePr, waitsFor: [lonePr.key] }
  const data = projectPrs({
    repos: [
      { repo: repos[0], prs: [bePr], error: null },
      { repo: repos[1], prs: [waiting], error: null },
      { repo: repos[2], prs: [lonePr], error: null }
    ]
  })
  view = await mount(panel, { host: stubs([], data) })
  assert.ok(view.find({ text: 'Waits for admin#9' }), 'the row says what it waits for')
  assert.ok(view.find({ text: 'fe#31 waits for admin#9, still open. Merge that first.' }))
  assert.equal(view.find({ role: 'button', text: 'Merge 2 in order' })?.disabled, true)
  assert.deepEqual(view.errors, [])
})

test('warns when one pull request is merged before its task\'s backend', async () => {
  const log: Log = []
  view = await mount(panel, { host: stubs(log) })
  await view.select({ label: 'View' }, 'repo')
  await view.press({ text: /#31 · feat\(cards\)/ })
  assert.equal(view.find({ role: 'button', text: 'Merge when green' })?.disabled, true, 'auto-merge would jump the order')
  await view.press({ role: 'button', text: 'Merge' })
  assert.ok(view.find({ text: /be#77 of the same task merges first/ }))
  assert.ok(view.find({ role: 'button', text: 'Merge anyway' }))
  await view.press({ role: 'button', text: 'Cancel' })
  assert.equal(calls(log, 'pr.act').length, 0)
})

test('checks a task out in every repo after confirming', async () => {
  const log: Log = []
  view = await mount(panel, { host: stubs(log) })
  await view.press({ role: 'button', text: 'Check out' })
  await view.press({ role: 'button', text: 'Check out' })
  assert.deepEqual(calls(log, 'task.checkout')[0]?.input.items, [
    { repo: 'acme/shop-be', branch: 'feat/42-gift-cards' },
    { repo: 'acme/shop-fe', branch: 'feat/42-gift-cards' }
  ])
  assert.ok(view.find({ text: 'on feat/42-gift-cards; on feat/42-gift-cards' }))
})

test('opens and merges releases from the Release tab', async () => {
  const log: Log = []
  view = await mount(panel, { host: stubs(log) })
  await view.select({ label: 'View' }, 'release')
  assert.ok(view.find({ type: 'Card', label: 'be' }))
  assert.ok(view.find({ text: '3 commits ahead of main' }))
  await view.press({ role: 'button', text: 'Open release PRs (1)' })
  await view.press({ role: 'button', text: 'Open' })
  assert.deepEqual(calls(log, 'release.open')[0]?.input, { projectId: 'p1', repo: 'acme/shop-be' })
  await view.press({ role: 'button', text: 'Merge releases in order (1)' })
  await view.press({ role: 'button', text: 'Merge 1' })
  assert.deepEqual(
    calls(log, 'pr.act').map((c) => [c.input.repo, c.input.method, c.input.deleteBranch]),
    [['acme/shop-admin', 'merge', false]]
  )
  assert.deepEqual(view.errors, [])
})

test('says once when checks never ran, instead of calling them failing', async () => {
  const quiet = { ...bePr, checks: neverRan }
  const data = projectPrs({
    ciNote: 'The job was not started because your spending limit needs to be increased.',
    repos: [{ repo: repos[0], prs: [quiet], error: null }]
  })
  view = await mount(panel, { host: stubs([], data) })
  assert.ok(view.find({ label: "Checks didn't run on 1 pull request" }))
  assert.ok(view.find({ text: "Checks didn't run" }), 'the row badge says so too')
  assert.equal(view.find({ text: /need attention/ }), null)
})

test('fetches again once what it shows is older than the refresh setting', async () => {
  const log: Log = []
  view = await mount(panel, { host: stubs(log) })
  const before = calls(log, 'prs.list').length
  refreshIfStale(projectPrs().fetchedAt + 60_000)
  await view.settled()
  assert.equal(calls(log, 'prs.list').length, before, 'a minute old: kept')
  refreshIfStale(projectPrs().fetchedAt + 4 * 60_000)
  await view.settled()
  assert.equal(calls(log, 'prs.list').length, before + 1, 'past three minutes: fetched')
})
