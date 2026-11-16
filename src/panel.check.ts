// `orca plugin check` renders the panel once per scenario. The worker's answers are stubbed so
// check never runs gh or reads this machine's projects.
import { defineCheck } from 'orca/testing'
import { bePr, detailOf, projectPrs } from './test/fixtures'

const projects = () => ({
  projects: [{ id: 'p1', name: 'shop', kind: 'folder' as const, path: '/work/shop' }],
  focusedProjectId: 'p1'
})

export default defineCheck({
  loaded: {
    requests: {
      'projects.list': projects,
      'prs.list': () => projectPrs(),
      'pr.detail': () => ({ detail: detailOf(bePr), error: null })
    }
  },
  empty: {
    requests: {
      'projects.list': projects,
      'prs.list': () => projectPrs({ repos: projectPrs().repos.map((r) => ({ ...r, prs: [] })) })
    }
  },
  noGh: {
    requests: {
      'projects.list': projects,
      'prs.list': () =>
        projectPrs({ repos: [], error: 'The gh CLI was not found. Install it from https://cli.github.com and run `gh auth login`.' })
    }
  },
  noProject: {
    requests: {
      'projects.list': () => ({ projects: [], focusedProjectId: null }),
      'prs.list': () => projectPrs({ project: null, repos: [] })
    }
  }
})
