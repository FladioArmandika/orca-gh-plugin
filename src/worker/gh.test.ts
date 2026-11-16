import { assert, test } from 'orca/testing'
import { actionArgs, flagsFor, summarizeChecks, toDetail, toSummary } from './gh'

const repo = { name: 'shop-be', path: '/work/shop/shop-be', slug: 'acme/shop-be', branch: null, problem: null }

test('counts checks as GitHub does: skipped passes, cancelled fails', () => {
  assert.deepEqual(
    summarizeChecks([
      { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'CANCELLED' },
      { __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: '' },
      { __typename: 'StatusContext', state: 'PENDING' },
      { __typename: 'StatusContext', state: 'ERROR' }
    ]),
    { total: 6, passed: 2, failed: 2, pending: 2 }
  )
  assert.deepEqual(summarizeChecks(null), { total: 0, passed: 0, failed: 0, pending: 0 })
})

test('turns gh pr list JSON into a summary', () => {
  const summary = toSummary(
    {
      number: 767,
      title: 'feat(cards): gift cards at checkout (1234)',
      url: 'https://github.com/acme/shop-be/pull/767',
      author: { login: 'Octo' },
      headRefName: 'feat/1234-gift-cards',
      headRefOid: 'abc123',
      baseRefName: 'development',
      isDraft: false,
      reviewDecision: '',
      mergeStateStatus: 'BLOCKED',
      mergeable: 'MERGEABLE',
      statusCheckRollup: [],
      updatedAt: '2026-11-15T10:00:00Z',
      labels: [{ name: 'backend' }],
      reviewRequests: [{ __typename: 'User', login: 'octo' }, { __typename: 'Team', name: 'core' }]
    },
    repo,
    'octo'
  )
  assert.equal(summary.key, 'acme/shop-be#767')
  assert.equal(summary.task, '1234')
  assert.equal(summary.reviewDecision, null, 'an empty decision means no review is required')
  assert.equal(summary.mine, true, 'logins compare without case')
  assert.equal(summary.reviewRequestedFromMe, true)
  assert.deepEqual(summary.labels, ['backend'])
  assert.equal(summary.updatedAt, Date.parse('2026-11-15T10:00:00Z'))
})

test('detail keeps each reviewer\'s latest verdict and flags risky files', () => {
  const detail = toDetail(
    {
      number: 1,
      title: 't',
      url: 'u',
      headRefName: 'feat/1-x',
      baseRefName: 'development',
      body: 'b',
      files: [{ path: 'src/db/migrations/20261116-add.ts', additions: 3, deletions: 0 }],
      reviews: [
        { author: { login: 'lead' }, state: 'CHANGES_REQUESTED', body: 'fix it', submittedAt: '2026-11-14T10:00:00Z' },
        { author: { login: 'lead' }, state: 'APPROVED', body: '', submittedAt: '2026-11-15T10:00:00Z' },
        { author: { login: 'lead' }, state: 'COMMENTED', body: 'nit', submittedAt: '2026-11-15T11:00:00Z' }
      ],
      comments: [{ author: { login: 'octo' }, body: 'ping', createdAt: '2026-11-14T09:00:00Z' }]
    },
    repo,
    null
  )
  assert.deepEqual(detail.reviewers, [{ login: 'lead', state: 'APPROVED' }])
  assert.deepEqual(detail.timeline.map((t) => t.body), ['ping', 'fix it', '', 'nit'])
  assert.deepEqual(detail.flags, ['Adds or changes a database migration'])
  assert.deepEqual(flagsFor(['src/payments/stripe.ts', 'src/auth/session.ts']), [
    'Touches authentication code',
    'Touches payment or billing code'
  ])
})

test('never deletes a kept branch and guards the merge with the head commit', () => {
  const input = { repo: 'acme/shop-be', number: 5, action: 'merge' as const, method: 'squash' as const, deleteBranch: true, sha: 'abc' }
  assert.deepEqual(actionArgs(input, 'feat/5-x', ['main', 'development']), [
    'pr', 'merge', '5', '-R', 'acme/shop-be', '--squash', '--match-head-commit', 'abc', '--delete-branch'
  ])
  assert.deepEqual(actionArgs({ ...input, method: 'merge' }, 'development', ['main', 'development']), [
    'pr', 'merge', '5', '-R', 'acme/shop-be', '--merge', '--match-head-commit', 'abc'
  ])
  assert.equal(typeof actionArgs({ repo: 'a/b', number: 1, action: 'request-changes', body: ' ' }, null, []), 'string')
  assert.deepEqual(actionArgs({ repo: 'a/b', number: 1, action: 'draft' }, null, []), ['pr', 'ready', '1', '-R', 'a/b', '--undo'])
})
