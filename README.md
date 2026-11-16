# Project PRs

An Orca sidebar panel for projects made of several GitHub repos (a folder project holding `*-be`,
`*-fe` and `*-admin`, say). It lists every open pull request of every repo inside the project, groups
the ones that belong to one task across repos, and lets you review, merge in order (backend first),
and open pull requests for a branch in each repo at once. Every GitHub call goes through the
[`gh` CLI](https://cli.github.com); the plugin keeps no token.

## What it does

- **Follows the focused workspace's project**, or a project you pick. In a folder project it looks for
  Git repos up to two folders down (Settings: folder depth); a Git project is its own single repo.
  SSH host aliases such as `git@github.com-work:owner/repo.git` are understood.
- **By task**: pull requests that share a task id, from the branch (`feat/1234-...`, `fix/fe-120-...`)
  or the title (`(BE-52)`, `(Tasks 987)`), else the same branch name, form one card across repos,
  listed in merge order. **Merge N in order** merges them one after another and stops at the first that
  fails; **Review with agent** starts an agent in one of the project's workspaces to review them together.
- **By repo**: each repo with its open pull requests, its GitHub slug and the branch checked out.
- **New PR**: repos whose checked-out branch has commits and no pull request yet. **Open PR** pushes the
  branch when needed and runs `gh pr create --fill`; one button opens the same branch in every repo.
- **Filters**: all open, needs my review, mine, ready to merge, needs attention (failing checks,
  conflicts, changes requested), hide drafts, and a search over title, branch, author, task and labels.
- **A pull request**: review decision and reviewers, checks, mergeability, changes, heads-ups for
  migrations and auth or payment code, the same task's pull requests in the other repos, merge (method,
  delete branch), update branch, comment, approve, request changes, ready for review / draft,
  close / reopen, its checks, files, description and conversation.

## Safety

- Every merge, close and new pull request asks first, in the panel.
- A merge passes `--match-head-commit`: if the branch got new commits after you looked, it refuses.
- Branches in **Branches never deleted**, the release branch and each repo's default branch are never
  deleted after a merge, whatever the checkbox says.
- `gh` runs outside your clones, so merging with "delete branch" never switches your working tree.
- **Open PR** only acts on repos the worker found itself.
- The review agent is told not to push, merge, approve or comment unless you ask it.

## Settings (Orca → Settings → Plugins → Project PRs)

| Setting | Default | |
| --- | --- | --- |
| Merge method | squash | for everything but the release branch |
| Release branch / method | `main` / merge commit | a `development → main` release keeps its history |
| Delete the branch after merging | on | the merge box's checkbox starts here |
| Branches never deleted | `main master development develop staging production release` | |
| Merge order across repos | `be backend api server` | names or name endings; others after, A to Z |
| Base branch for new pull requests | where most open feature PRs go, else the repo's default branch | e.g. `development` |
| Agent for Review with agent | none | the Orca agent id, e.g. `codex`; set it once before reviewing |
| Folder depth / PRs per repo | 2 / 50 | |

If your repos' GitHub default branch is `main` but feature work goes into `development`, set
**Base branch for new pull requests** to `development` so new PRs never target `main` when no
feature PR is open.

## Requirements

- Orca 1.4.259 or later.
- `gh` installed and logged in (`gh auth login`) with access to the repos.

## Permissions

A `trusted-worker`: its worker runs `git` and `gh` on this machine with your user's access.

- `workspace:read`: Orca's projects and workspaces, to find the project's folder and the focused one.
- `settings:own`: the settings above.
- `agent:launch`: **Review with agent** starts an agent in a workspace of the project.

## Develop

```sh
npm install                 # TypeScript and Node typings, for npx tsc -p .
orca plugin test . --json   # unit tests (worker with a fake gh/git, panel with a stand-in worker)
orca plugin check . --json  # renders each scenario in src/panel.check.ts
orca plugin dev watch . --check --json
```

`src/protocol.ts` declares the panel ↔ worker contract; `src/worker/` holds the gh, git and repo
discovery code; `src/panel/` the views; `src/shared/` grouping and badges used by both.
