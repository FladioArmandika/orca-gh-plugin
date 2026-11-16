# Project PRs

An Orca sidebar panel for projects made of several GitHub repos (a folder project holding `*-be`,
`*-fe` and `*-admin`, say). It lists every open pull request of every repo inside the project, groups
the ones that belong to one task across repos, and lets you review, merge in order (backend first),
check a task out in every repo, open pull requests for a branch in each repo at once, and release
`development` to `main` everywhere. A status bar item and notifications keep you posted. Every GitHub
call goes through the [`gh` CLI](https://cli.github.com); the plugin keeps no token.

## What it does

- **Follows the focused workspace's project**, or a project you pick. In a folder project it looks for
  Git repos up to two folders down (Settings: folder depth); a Git project is its own single repo.
  SSH host aliases such as `git@github.com-work:owner/repo.git` are understood. Repos show by the
  part of their name that differs: `shop-be`, `shop-fe` read `be`, `fe`.
- **By task**: pull requests that share a task id, from the branch (`feat/1234-...`, `fix/fe-120-...`)
  or the title (`(BE-52)`, `(Tasks 987)`), else the same branch name, form one card across repos,
  named after the task when a description has a `Task: [name](link)` line, and listed in merge order.
  - **Merge N in order** merges one pull request at a time, saying which one is going, and stops at
    the first that fails.
  - **Check out** switches every repo to the task's branch (fetching it first; a repo with
    uncommitted changes is left alone); **Back to development** switches them back.
  - **Review with agent** starts an agent in one of the project's workspaces to review them together.
  - **Task** opens the task's link.
- **Merge dependencies from descriptions**: "Merge after be#12", "depends on #12", "built on
  owner/repo#12" or a pull request link. A pull request that waits for an open one shows it, a task
  merge goes after what it waits for, and one that waits outside the task is held.
- **By repo**: each repo, backend first, with its open pull requests, slug and checked-out branch.
- **New PR**: repos whose checked-out branch has commits and no pull request yet. **Open PR** pushes the
  branch when needed and runs `gh pr create --fill`; one button opens the same branch in every repo.
- **Release**: for each repo, how far `development` is ahead of `main` and what it brings. **Open
  release PRs** opens `development → main` in each repo that has something to release, titled with
  the date and listing the commits; **Merge releases in order** merges them backend first with a merge
  commit, one at a time.
- **Filters**: all open, needs my review, mine, ready to merge, needs attention (failing checks,
  conflicts, changes requested), hide drafts, and a search over title, branch, author, task and labels.
- **A pull request**: task, review decision and reviewers, checks, mergeability, changes, heads-ups for
  migrations and auth or payment code; the same task's pull requests in the other repos; one Actions
  card to merge (method, delete branch), **Merge when green** (GitHub auto-merge), update branch, ready
  for review or draft, close or reopen; comment, approve, request changes; the description; each
  file's diff; the conversation.
- **Checks that never ran**: when GitHub did not start a job (a spending limit, a failed payment), the
  panel says so once, in GitHub's words, and shows "Checks didn't run" rather than "failing".
- **Status bar and notifications**: an item such as `13 PRs · 2 to review · 1 ready` for the project the
  panel last showed (press it to refresh), and a notification when your review is requested, a task
  becomes ready to merge, or one of your pull requests is approved or gets changes requested.
- **Stays current**: the open panel and the status bar fetch again every few minutes (Settings).

## Safety

- Every merge, auto-merge, close, checkout, new pull request and release asks first, in the panel.
- A merge passes `--match-head-commit`: if the branch got new commits after you looked, it refuses.
- Merging one pull request before what it waits for, or before its task's backend, says so and asks
  for **Merge anyway**; **Merge when green** is off then, since it could jump the order.
- Branches in **Branches never deleted**, the release branch and each repo's default branch are never
  deleted after a merge, whatever the checkbox says. Releases never delete `development`.
- `gh` runs outside your clones, so merging with "delete branch" never switches your working tree.
- **Check out** leaves a repo with uncommitted changes as it is and only fast-forwards.
- **Open PR**, checkout and releases act only on repos the worker found itself.
- The review agent is told not to push, merge, approve or comment unless you ask it.

## Settings (Orca → Settings → Plugins → Project PRs)

| Setting | Default | |
| --- | --- | --- |
| Merge method | squash | for everything but the release branch |
| Release branch / method | `main` / merge commit | a `development → main` release keeps its history |
| Branch releases are made from | `development` | the Release tab compares it with the release branch |
| Delete the branch after merging | on | the Actions card's checkbox starts here |
| Branches never deleted | `main master development develop staging production release` | |
| Merge order across repos | `be backend api server` | names or name endings; others after, A to Z |
| Base branch for new pull requests | where most open feature PRs go, else the repo's default branch | e.g. `development` |
| Agent for Review with agent | none | the Orca agent id, e.g. `codex`; set it once before reviewing |
| Refresh every (minutes) | 3 | the open panel and the status bar; 0 turns it off |
| Notify me | on | review requests, tasks ready to merge, verdicts on your pull requests |
| Folder depth / PRs per repo | 2 / 50 | |

If your repos' GitHub default branch is `main` but feature work goes into `development`, set
**Base branch for new pull requests** to `development` so new PRs never target `main` when no
feature PR is open.

## Requirements

- Orca 1.4.259 or later.
- `gh` installed and logged in (`gh auth login`) with access to the repos. **Merge when green** needs
  the repo's "Allow auto-merge" setting.

## Permissions

A `trusted-worker`: its worker runs `git` and `gh` on this machine with your user's access.

- `workspace:read`: Orca's projects and workspaces, to find the project's folder and the focused one.
- `settings:own`: the settings above.
- `agent:launch`: **Review with agent** starts an agent in a workspace of the project.
- `notifications:show`: the notifications above.
- `storage:own`: remembers which project the status bar follows.

## Develop

```sh
npm install                 # TypeScript and Node typings, for npx tsc -p .
orca plugin test . --json   # unit tests (worker with a fake gh/git, panel with a stand-in worker)
orca plugin check . --json  # renders each scenario in src/panel.check.ts
orca plugin dev watch . --check --json
```

`src/protocol.ts` declares the panel ↔ worker contract; `src/worker/` holds the gh, git, repo
discovery, checks, diff, release, checkout and status code; `src/panel/` the views; `src/shared/`
grouping, dependencies, titles and badges used by both.
