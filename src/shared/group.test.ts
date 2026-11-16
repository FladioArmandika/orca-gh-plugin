import { assert, test } from 'orca/testing'
import { bePr, fePr, lonePr, pr } from '../test/fixtures'
import { groupPrs, isReady, matches, methodFor, parseList, repoRank, taskOf } from './group'

test('reads the task id from the branch, then the title', () => {
  assert.equal(taskOf('feat/1234-gift-cards', 'x'), '1234')
  assert.equal(taskOf('feat/fe-120-wishlist', 'x'), 'FE-120')
  assert.equal(taskOf('chore/BE-52', 'x'), 'BE-52')
  assert.equal(taskOf('fix/cart-totals', 'fix(cart): totals round to cents (Tasks 987)'), '987')
  assert.equal(taskOf('fix/cart-totals', 'feat: thing (ADMIN-7)'), 'ADMIN-7')
  assert.equal(taskOf('fix/cart-totals', 'fix: no id here'), null)
  assert.equal(taskOf('main', 'Release'), null)
})

test('orders repos by name or name ending, others after', () => {
  const order = parseList('be, admin  fe')
  assert.deepEqual(order, ['be', 'admin', 'fe'])
  assert.equal(repoRank('shop-be', order), 0)
  assert.equal(repoRank('shop-admin', order), 1)
  assert.equal(repoRank('shop-fe', order), 2)
  assert.equal(repoRank('docs', order), 3)
  assert.equal(repoRank('website', order), 3, 'a name merely ending in "be" letters without a dash does not match')
})

test('groups one task across repos, backend first, newest first', () => {
  const groups = groupPrs([fePr, lonePr, bePr], ['be'])
  assert.equal(groups.length, 2)
  const task = groups.find((g) => g.key === 'task:42')
  assert.ok(task)
  assert.equal(task.label, 'Task 42')
  assert.equal(task.branch, 'feat/42-gift-cards')
  assert.deepEqual(task.prs.map((p) => p.repoName), ['shop-be', 'shop-fe'])
  const lone = groups.find((g) => g.key === 'branch:fix/typo')
  assert.equal(lone?.label, 'fix/typo')
})

test('filters by review, ownership, readiness and search words', () => {
  assert.equal(matches(fePr, 'review', false, ''), true)
  assert.equal(matches(bePr, 'review', false, ''), false)
  assert.equal(matches(lonePr, 'mine', false, ''), true)
  assert.equal(isReady(bePr), true)
  assert.equal(isReady(fePr), false)
  assert.equal(matches(bePr, 'ready', false, ''), true)
  assert.equal(matches(fePr, 'attention', false, ''), true)
  assert.equal(matches(pr({ repo: 'a/b', number: 1, draft: true }), 'all', true, ''), false)
  assert.equal(matches(fePr, 'all', false, 'gift #31'), true)
  assert.equal(matches(fePr, 'all', false, 'gift #77'), false)
})

test('uses the release merge method only into the release branch', () => {
  const defaults = { mergeMethod: 'squash', releaseBranch: 'main', releaseMergeMethod: 'merge' }
  assert.equal(methodFor({ base: 'development' }, defaults), 'squash')
  assert.equal(methodFor({ base: 'main' }, defaults), 'merge')
  assert.equal(methodFor({ base: 'main' }, { ...defaults, releaseBranch: '' }), 'squash')
})
