import { assert, test } from 'orca/testing'
import { bePr, fePr, green, lonePr, projectPrs, repos } from '../test/fixtures'
import { fingerprint, snapshot, statusOf, whatChanged } from './watch'

test('sums up the project for the status bar', () => {
  const status = statusOf(projectPrs())
  assert.deepEqual([status.text, status.tone, status.visible], ['3 PRs · 1 to review · 2 ready', 'accent', true])
  assert.match(status.tooltip, /^Project PRs in shop: 3 open, 1 waiting for your review, 2 ready to merge, 1 need attention/)
  assert.equal(statusOf(projectPrs({ project: null })).visible, false)
  assert.equal(statusOf(null).visible, false)
})

test('notifies new review requests, tasks turning ready and verdicts on mine, never on the first look', () => {
  const before = projectPrs()
  assert.deepEqual(whatChanged(null, before), [])
  const fixedFe = { ...fePr, checks: green, mergeState: 'CLEAN', reviewDecision: 'APPROVED' }
  const newReview = {
    ...lonePr,
    number: 10,
    key: 'acme/shop-admin#10',
    head: 'feat/7-wishlist',
    task: '7',
    reviewDecision: 'REVIEW_REQUIRED',
    reviewRequestedFromMe: true,
    mine: false,
    headline: 'Wishlist'
  }
  // Approved, but its checks still run: a verdict, not yet ready.
  const approvedMine = { ...lonePr, reviewDecision: 'APPROVED', checks: { ...green, passed: 2, pending: 1 } }
  const after = projectPrs({
    repos: [
      { repo: repos[0], prs: [bePr], error: null },
      { repo: repos[1], prs: [fixedFe], error: null },
      { repo: repos[2], prs: [approvedMine, newReview], error: null }
    ]
  })
  const beforeMine = projectPrs({
    repos: [
      { repo: repos[0], prs: [bePr], error: null },
      { repo: repos[1], prs: [fePr], error: null },
      { repo: repos[2], prs: [{ ...lonePr, reviewDecision: 'REVIEW_REQUIRED' }], error: null }
    ]
  })
  assert.deepEqual(
    whatChanged(snapshot(beforeMine), after).map((n) => n.title),
    ['Review requested: admin#10', 'Task 42 is ready to merge', 'admin#9 approved']
  )
  assert.notEqual(fingerprint(before), fingerprint(after))
  assert.equal(fingerprint(before), fingerprint(projectPrs()))
})
