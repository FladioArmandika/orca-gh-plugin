import { assert, test } from 'orca/testing'
import { markRuns, notRunNote, NotRunProbe, withNotRun } from './checks'
import { setRunner } from './exec'

test('recognises a job GitHub never started', () => {
  assert.equal(
    notRunNote(['The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check billing.']),
    'The job was not started because recent account payments have failed or your spending limit needs to be increased.'
  )
  assert.equal(notRunNote(['Process completed with exit code 1.']), null)
  assert.equal(notRunNote([]), null)
})

test('moves never-started jobs from failed to notRun, in summaries and runs', async () => {
  setRunner(async (_cmd, args) => ({
    code: 0,
    stdout: args[1].includes('/check-runs/1/') ? 'The job was not started because your spending limit needs to be increased.' : 'exit code 1',
    stderr: ''
  }))
  try {
    const probe = new NotRunProbe()
    await probe.probe([
      { slug: 'a/b', job: '1' },
      { slug: 'a/b', job: '2' },
      { slug: 'a/b', job: '1' }
    ])
    const summary = { total: 3, passed: 1, failed: 2, pending: 0, skipped: 0, notRun: 0 }
    const marked = withNotRun(summary, ['1', '2'], probe)
    assert.deepEqual([marked.checks.failed, marked.checks.notRun], [1, 1])
    assert.match(marked.note ?? '', /spending limit/)
    const runs = markRuns(
      [
        { name: 'a', state: 'failed', url: 'job-1', note: null },
        { name: 'b', state: 'failed', url: 'job-2', note: null },
        { name: 'c', state: 'passed', url: null, note: null }
      ],
      summary,
      (url) => url?.replace('job-', '') ?? null,
      probe
    )
    assert.deepEqual(runs.runs.map((r) => r.state), ['not-run', 'failed', 'passed'])
    assert.deepEqual([runs.checks.failed, runs.checks.notRun], [1, 1])
  } finally {
    setRunner(null)
  }
})
