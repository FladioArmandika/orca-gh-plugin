// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.

/** An Orca project (a Git repository or a folder) on this machine. */
export type ProjectInfo = { id: string; name: string; kind: 'git' | 'folder'; path: string }

/** A Git repository found inside a project's folder. `slug` is GitHub's `owner/name`; null when
 *  the repository has no GitHub remote (then `problem` says why and it lists no pull requests).
 *  `short` is the name without the prefix every repo of the project shares (`be` for shop-be). */
export type RepoInfo = {
  name: string
  short: string
  path: string
  slug: string | null
  branch: string | null
  problem: string | null
}

/** `notRun`: failed checks GitHub never started (billing, no runner), counted apart. */
export type ChecksSummary = {
  total: number
  passed: number
  failed: number
  pending: number
  skipped: number
  notRun: number
}
export type CheckState = 'passed' | 'failed' | 'pending' | 'skipped' | 'not-run'
export type MergeMethod = 'squash' | 'merge' | 'rebase'

/** One open pull request, as the lists show it. `key` is `owner/name#number`. */
export type PrSummary = {
  key: string
  repo: string
  /** The repo's folder name, which the merge order matches. */
  repoName: string
  /** The short name the panel shows: `be`. */
  repoLabel: string
  number: number
  title: string
  /** The title without its `type(scope):` prefix and task suffix, capitalised. */
  headline: string
  /** `feat(cards)` from a conventional title; null otherwise. */
  kind: string | null
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
  /** Auto-merge is on: GitHub merges it once its checks pass. */
  autoMerge: boolean
  /** The task id in the branch (`feat/1234-...`) or title (`(BE-52)`), upper-cased. */
  task: string | null
  /** The task's name and link, from a `Task: [name](url)` line in the description. */
  taskTitle: string | null
  taskUrl: string | null
  /** Open pull requests of the project this one waits for, by key, from its description
   *  ("Merge after be#12"). */
  waitsFor: string[]
}

export type RepoPrs = { repo: RepoInfo; prs: PrSummary[]; error: string | null }

/** What the panel needs to act the way the person set it up in Settings. */
export type MergeDefaults = {
  mergeMethod: MergeMethod
  releaseBranch: string
  releaseMergeMethod: MergeMethod
  /** The branch releases are made from (`development`). */
  developBranch: string
  deleteBranch: boolean
  /** Branches never deleted after a merge, whatever the checkbox says. */
  keepBranches: string[]
  /** Repo-name tokens in merge order (`be` matches `shop-be`). */
  mergeOrder: string[]
  agent: string
  /** How often an open panel fetches again; 0 never. */
  refreshMinutes: number
}

export type ProjectPrs = {
  project: ProjectInfo | null
  viewer: string | null
  repos: RepoPrs[]
  fetchedAt: number
  defaults: MergeDefaults
  /** Why some checks never ran (GitHub's own words), when that is the case. */
  ciNote: string | null
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

export type CheckRun = { name: string; state: CheckState; url: string | null; note: string | null }

export type PrDetail = PrSummary & {
  state: string
  body: string
  createdAt: number
  changedFiles: number
  files: { path: string; additions: number; deletions: number }[]
  checkRuns: CheckRun[]
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
  | 'auto-merge'
  | 'cancel-auto-merge'
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

/** One repo's release: how far the develop branch is ahead of the release branch. */
export type ReleaseRepo = {
  repo: RepoInfo
  ahead: number | null
  behind: number | null
  /** Subjects of the commits a release would bring, newest first. */
  commits: string[]
  /** The open release pull request (develop → release), if there is one. */
  pr: PrSummary | null
  error: string | null
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
    /** One file's diff, cut to what a panel can show. */
    'pr.diff': {
      input: { repo: string; number: number; sha: string; path: string }
      output: { patch: string | null; truncated: boolean; error: string | null }
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
    /** Switches each repo to a branch (fetching it first); repos with uncommitted changes are
     *  left alone. */
    'task.checkout': {
      input: { projectId: string | null; items: { repo: string; branch: string }[] }
      output: { results: ActionResult[] }
    }
    'release.status': {
      input: { projectId: string | null }
      output: { head: string; base: string; repos: ReleaseRepo[]; error: string | null }
    }
    /** Opens the develop → release pull request of one repo, listing its commits. */
    'release.open': { input: { projectId: string | null; repo: string }; output: ActionResult & { url: string | null } }
    /** The project the status bar follows: the one the panel shows. */
    'watch.set': { input: { projectId: string | null }; output: { ok: boolean } }
  }
  interface PluginPanelEvents {
    /** Something changed on GitHub (a merge, review, new PR): open panels reload. */
    'prs.changed': { repos: string[] }
  }
}
