// Failed checks GitHub never started (spending limit, failed payment, no runner) look like
// failures in a pull request's rollup. The check run's annotations say which they are; a check
// run never changes once done, so each answer is kept for the worker's life.
import type { CheckRun, ChecksSummary } from '../protocol'
import { run, type Run } from './exec'
import { gh } from './gh'

const NOT_RUN = /\bnot (?:been )?started\b|spending limit|payments? (?:have |has )?failed|billing/i
const MAX_PROBES = 80
const PARALLEL = 8

/** The annotation that says a job never started, cut to its first sentence; null otherwise. */
export function notRunNote(messages: readonly string[]): string | null {
  const found = messages.find((message) => NOT_RUN.test(message))
  if (!found) return null
  const sentence = found.trim().split(/(?<=\.)\s+/)[0]
  return sentence.length > 220 ? `${sentence.slice(0, 217)}…` : sentence
}

export class NotRunProbe {
  private readonly answers = new Map<string, string | null>()

  constructor(private readonly runner: Run = run) {}

  known(job: string): string | null | undefined {
    return this.answers.get(job)
  }

  /** Asks GitHub about the jobs not asked yet, a few at a time and at most MAX_PROBES per call;
   *  a failed ask is not kept, so it is asked again next time. */
  async probe(jobs: readonly { slug: string; job: string }[]): Promise<void> {
    const todo = jobs.filter((j, i) => !this.answers.has(j.job) && jobs.findIndex((o) => o.job === j.job) === i).slice(0, MAX_PROBES)
    for (let i = 0; i < todo.length; i += PARALLEL) {
      await Promise.all(
        todo.slice(i, i + PARALLEL).map(async ({ slug, job }) => {
          try {
            const out = await gh(['api', `repos/${slug}/check-runs/${job}/annotations`, '--jq', '.[].message'], this.runner)
            this.answers.set(job, notRunNote(out.split('\n').filter(Boolean)))
          } catch {
            // Unknown: counted as failed this time.
          }
        })
      )
    }
  }
}

/** The summary with every job the probe found never started moved from failed to notRun. */
export function withNotRun(checks: ChecksSummary, jobs: readonly string[], probe: NotRunProbe): { checks: ChecksSummary; note: string | null } {
  let notRun = 0
  let note: string | null = null
  for (const job of jobs) {
    const answer = probe.known(job)
    if (answer) {
      notRun++
      note ??= answer
    }
  }
  return { checks: { ...checks, failed: checks.failed - notRun, notRun: checks.notRun + notRun }, note }
}

/** A detail's check runs and summary, with the ones that never started marked. */
export function markRuns(
  runs: readonly CheckRun[],
  checks: ChecksSummary,
  jobOf: (url: string | null) => string | null,
  probe: NotRunProbe
): { runs: CheckRun[]; checks: ChecksSummary } {
  let notRun = 0
  const marked = runs.map((r) => {
    const job = r.state === 'failed' ? jobOf(r.url) : null
    const note = job ? probe.known(job) : null
    if (!note) return r
    notRun++
    return { ...r, state: 'not-run' as const, note }
  })
  return { runs: marked, checks: { ...checks, failed: checks.failed - notRun, notRun: checks.notRun + notRun } }
}
