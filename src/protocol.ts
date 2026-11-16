// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.

/** An Orca project (a Git repository or a folder) on this machine. */
export type ProjectInfo = { id: string; name: string; kind: 'git' | 'folder'; path: string }

/** A Git repository found inside a project's folder. `slug` is GitHub's `owner/name`; null when
 *  the repository has no GitHub remote (then `problem` says why and it lists no pull requests). */
export type RepoInfo = {
  name: string
  path: string
  slug: string | null
  branch: string | null
  problem: string | null
}

export type ChecksSummary = { total: number; passed: number; failed: number; pending: number }
export type CheckState = 'passed' | 'failed' | 'pending' | 'skipped'
export type MergeMethod = 'squash' | 'merge' | 'rebase'

/** One open pull request, as the lists show it. `key` is `owner/name#number`. */
export type PrSummary = {
  key: string
  repo: string
  repoName: string
  number: number
  title: string
  url: string
  author: string
  head: string
  headSha: string
  base: string
  draft: boolean
  /** APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or null when the repo needs no review. */
  reviewDecision: string | null
  /** GitHub's mergeStateStatus: CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, DRAFT, HAS_HOOKS, UNKNOWN. */
  mergeState: string
  /** MERGEABLE, CONFLICTING or UNKNOWN (GitHub works it out on the first ask). */
  mergeable: string
  checks: ChecksSummary
  updatedAt: number
  additions: number
  deletions: number
  labels: string[]
  reviewRequestedFromMe: boolean
  mine: boolean
  /** The task id in the branch (`feat/1234-...`) or title (`(BE-52)`), upper-cased. */
  task: string | null
}

export type RepoPrs = { repo: RepoInfo; prs: PrSummary[]; error: string | null }

/** What the panel needs to merge the way the person set it up in Settings. */
export type MergeDefaults = {
  mergeMethod: MergeMethod
  releaseBranch: string
  releaseMergeMethod: MergeMethod
  deleteBranch: boolean
  /** Branches never deleted after a merge, whatever the checkbox says. */
  keepBranches: string[]
  /** Repo-name tokens in merge order (`be` matches `shop-be`). */
  mergeOrder: string[]
  agent: string
}

export type ProjectPrs = {
  project: ProjectInfo | null
  viewer: string | null
  repos: RepoPrs[]
  fetchedAt: number
  defaults: MergeDefaults
  /** Set when the whole list failed (no `gh`, not logged in). */
  error: string | null
}

export type TimelineItem = {
  kind: 'comment' | 'review'
  author: string
  at: number
  body: string
  /** Reviews: APPROVED, CHANGES_REQUESTED, COMMENTED, DISMISSED. */
  state: string | null
}

export type PrDetail = PrSummary & {
  state: string
  body: string
  createdAt: number
  changedFiles: number
  files: { path: string; additions: number; deletions: number }[]
  checkRuns: { name: string; state: CheckState; url: string | null }[]
  timeline: TimelineItem[]
  /** Each reviewer's latest review state. */
  reviewers: { login: string; state: string }[]
  /** Things to look at before merging: migrations, auth or payment code. */
  flags: string[]
}

export type PrAction =
  | 'approve'
  | 'request-changes'
  | 'comment'
  | 'merge'
  | 'ready'
  | 'draft'
  | 'close'
  | 'reopen'
  | 'update-branch'

export type ActionResult = { ok: boolean; message: string }

/** A repo whose checked-out branch has commits and no open pull request yet. */
export type NewPrCandidate = {
  repo: RepoInfo
  branch: string
  base: string
  /** Commits on the branch that `origin/<base>` does not have; null when unknown. */
  ahead: number | null
  /** Commits not pushed yet; null when the branch tracks no remote branch. */
  unpushed: number | null
  dirty: boolean
}

declare module 'orca' {
  interface PluginRequests {
    /** Orca's local projects and the one the focused workspace belongs to. */
    'projects.list': { output: { projects: ProjectInfo[]; focusedProjectId: string | null } }
    /** Every open pull request of every GitHub repo inside the project. */
    'prs.list': { input: { projectId: string | null; refresh?: boolean }; output: ProjectPrs }
    'pr.detail': {
      input: { repo: string; number: number }
      output: { detail: PrDetail | null; error: string | null }
    }
    'pr.act': {
      input: {
        repo: string
        number: number
        action: PrAction
        body?: string
        method?: MergeMethod
        deleteBranch?: boolean
        /** Merge only if the head is still this commit. */
        sha?: string
      }
      output: ActionResult
    }
    /** Merges several pull requests one after another, in the configured repo order, and stops
     *  at the first that fails. */
    'group.merge': {
      input: {
        prs: { repo: string; number: number; sha: string }[]
        method?: MergeMethod
        deleteBranch?: boolean
      }
      output: { results: { key: string; ok: boolean; message: string }[] }
    }
    'pr.candidates': { input: { projectId: string | null }; output: { candidates: NewPrCandidate[]; error: string | null } }
    /** Pushes the repo's branch when needed and opens a pull request with `gh pr create --fill`. */
    'pr.create': {
      input: { projectId: string | null; repoPath: string; base: string; draft?: boolean }
      output: ActionResult & { url: string | null }
    }
    /** Starts the configured agent in one of the project's workspaces to review the PRs. */
    'agent.review': {
      input: { projectId: string | null; prs: { repo: string; number: number }[] }
      output: ActionResult
    }
  }
  interface PluginPanelEvents {
    /** Something changed on GitHub (a merge, review, new PR): open panels reload. */
    'prs.changed': { repos: string[] }
  }
}
