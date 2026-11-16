// The panel with the worker stood in for: what each plugin.request answers.
import { afterEach, assert, mockHost, mount, test, type TestPanel } from 'orca/testing'
import * as panel from './panel'
import { bePr, detailOf, fePr, projectPrs } from './test/fixtures'

let view: TestPanel | undefined
afterEach(() => view?.unmount())

function stubs(log: { name: string; input: unknown }[] = []) {
  const record =
    <T,>(name: string, answer: (input: any) => T) =>
    (input: unknown) => {
      log.push({ name, input })
      return answer(input)
    }
  return mockHost({
    capabilities: ['workspace:read', 'settings:own', 'agent:launch'],
    requests: {
      'projects.list': record('projects.list', () => ({
        projects: [{ id: 'p1', name: 'shop', kind: 'folder', path: '/work/shop' }],
        focusedProjectId: 'p1'
      })),
      'prs.list': record('prs.list', () => projectPrs()),
      'pr.detail': record('pr.detail', ({ repo, number }) => ({
        detail: detailOf(repo === bePr.repo && number === bePr.number ? bePr : fePr),
        error: null
      })),
      'pr.act': record('pr.act', () => ({ ok: true, message: 'Merged shop-be#77 (squash)' })),
      'group.merge': record('group.merge', () => ({
        results: [
          { key: bePr.key, ok: true, message: 'Merged shop-be#77' },
          { key: fePr.key, ok: true, message: 'Merged shop-fe#31' }
        ]
      })),
      'agent.review': record('agent.review', () => ({ ok: true, message: 'Started codex in shop' }))
    }
  })
}

test('groups the task across repos and summarises the project', async () => {
  view = await mount(panel, { host: stubs() })
  assert.ok(view.find({ type: 'Card', label: 'Task 42' }), 'the cross-repo task has its own card')
  assert.ok(view.find({ text: 'Across repos (1)' }))
  assert.ok(view.find({ text: 'Single repo (1)' }))
  assert.ok(view.find({ text: '3 open' }))
  assert.ok(view.find({ text: '1 to review' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})

test('merges a whole task only after confirming, in order', async () => {
  const log: { name: string; input: unknown }[] = []
  view = await mount(panel, { host: stubs(log) })
  await view.press({ role: 'button', text: 'Merge 2 in order' })
  assert.ok(view.find({ label: 'Merge Task 42?' }), 'asks first')
  assert.equal(log.filter((l) => l.name === 'group.merge').length, 0)
  await view.press({ role: 'button', text: 'Merge 2' })
  const merge = log.find((l) => l.name === 'group.merge')?.input as { prs: { repo: string; sha: string }[]; method: string }
  assert.deepEqual(merge.prs.map((p) => p.repo), ['acme/shop-be', 'acme/shop-fe'])
  assert.equal(merge.method, 'squash')
  assert.ok(view.find({ text: /Merged shop-be#77; Merged shop-fe#31/ }))
  assert.deepEqual(view.errors, [])
})

test('filters to what needs my review', async () => {
  view = await mount(panel, { host: stubs() })
  await view.select({ label: 'Show' }, 'review')
  assert.equal(view.find({ type: 'Card', label: 'Task 42' }), null, 'one PR left: no cross-repo card')
  assert.ok(view.find({ text: /#31 feat\(cards\)/ }))
  assert.equal(view.find({ text: /#77 / }), null)
})

test('opens a pull request and merges it with the head commit', async () => {
  const log: { name: string; input: unknown }[] = []
  view = await mount(panel, { host: stubs(log) })
  await view.select({ label: 'View' }, 'repo')
  await view.press({ text: /#77 feat\(cards\)/ })
  assert.ok(view.find({ role: 'heading', text: bePr.title }))
  assert.ok(view.find({ type: 'Card', label: 'Same task (42) in other repos' }), 'shows the fe PR of the same task')
  await view.press({ role: 'button', text: 'Merge' })
  await view.press({ role: 'button', text: 'Merge' })
  const act = log.find((l) => l.name === 'pr.act')?.input as Record<string, unknown>
  assert.deepEqual(act, { repo: 'acme/shop-be', number: 77, action: 'merge', method: 'squash', deleteBranch: true, sha: 'sha-77' })
  assert.ok(view.find({ text: 'Merged shop-be#77 (squash)' }))
  await view.press({ text: '← All pull requests' })
  assert.ok(view.find({ label: 'shop-be (1)' }))
  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
})
