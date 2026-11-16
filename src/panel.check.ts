// `orca plugin check` renders the panel once per scenario. The worker's answers are stubbed so
// check never runs gh or reads this machine's projects.
import { defineCheck } from 'orca/testing'
import { bePr, detailOf, neverRan, projectPrs, repos } from './test/fixtures'

const projects = () => ({
  projects: [{ id: 'p1', name: 'shop', kind: 'folder' as const, path: '/work/shop' }],
  focusedProjectId: 'p1'
})
const watch = () => ({ ok: true })

export default defineCheck({
  loaded: {
    requests: {
      'projects.list': projects,
      'prs.list': () => projectPrs(),
      'pr.detail': () => ({ detail: detailOf(bePr), error: null }),
      'watch.set': watch
    }
  },
  checksNeverRan: {
    requests: {
      'projects.list': projects,
      'prs.list': () =>
        projectPrs({
          ciNote: 'The job was not started because your spending limit needs to be increased.',
          repos: [{ repo: repos[0], prs: [{ ...bePr, checks: neverRan }], error: null }]
        }),
      'watch.set': watch
    }
  },
  empty: {
    requests: {
      'projects.list': projects,
      'prs.list': () => projectPrs({ repos: projectPrs().repos.map((r) => ({ ...r, prs: [] })) }),
      'watch.set': watch
    }
  },
  noGh: {
    requests: {
      'projects.list': projects,
      'prs.list': () =>
        projectPrs({ repos: [], error: 'The gh CLI was not found. Install it from https://cli.github.com and run `gh auth login`.' }),
      'watch.set': watch
    }
  },
  noProject: {
    requests: {
      'projects.list': () => ({ projects: [], focusedProjectId: null }),
      'prs.list': () => projectPrs({ project: null, repos: [] }),
      'watch.set': watch
    }
  }
})
