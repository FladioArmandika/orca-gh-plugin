// Project PRs: every open pull request of the GitHub repos inside the focused Orca project,
// grouped by task across repos. No build step: Orca compiles this file when the panel loads.
import { on, plugin, read, type PanelContext } from 'orca'
import { detailView } from './panel/detail'
import { listView } from './panel/lists'
import {
  candidates,
  loadCandidates,
  loadDetail,
  loadList,
  loadProjects,
  loadRelease,
  onFocusChanged,
  refreshIfStale,
  release,
  selected,
  view
} from './panel/state'

/** How often the panel checks whether what it shows is older than the refresh setting. */
const TICK_MS = 30_000

export function setup(ctx: PanelContext): () => void {
  // A merge, review or new PR from any panel, or the worker seeing a change: reload.
  ctx.subscriptions.push(
    plugin.on('prs.changed', () => {
      void loadList()
      if (read(selected)) void loadDetail()
      if (read(candidates) !== null) void loadCandidates()
      if (read(release) !== null && read(view) === 'release') void loadRelease()
    })
  )
  ctx.subscriptions.push(on('workspace.changed', () => void onFocusChanged()))
  void loadProjects().then(() => {
    void loadList()
    if (read(view) === 'new') void loadCandidates()
    if (read(view) === 'release') void loadRelease()
  })
  // Only while the panel is in view; coming back into view catches up on the next tick.
  const timer = setInterval(() => {
    if (read(ctx.visible)) refreshIfStale()
  }, TICK_MS)
  ;(timer as { unref?: () => void }).unref?.()
  return () => clearInterval(timer)
}

export default function Panel() {
  return read(selected) ? detailView() : listView()
}
