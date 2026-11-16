// Project PRs: every open pull request of the GitHub repos inside the focused Orca project,
// grouped by task across repos. No build step: Orca compiles this file when the panel loads.
import { on, plugin, read, type PanelContext } from 'orca'
import { detailView } from './panel/detail'
import { listView } from './panel/lists'
import { candidates, loadCandidates, loadDetail, loadList, loadProjects, onFocusChanged, selected, view } from './panel/state'

export function setup(ctx: PanelContext): void {
  // A merge, review or new PR from any panel: reload what this one shows.
  ctx.subscriptions.push(
    plugin.on('prs.changed', () => {
      void loadList()
      if (read(selected)) void loadDetail()
      if (read(candidates) !== null) void loadCandidates()
    })
  )
  ctx.subscriptions.push(on('workspace.changed', () => void onFocusChanged()))
  void loadProjects().then(() => {
    void loadList()
    if (read(view) === 'new') void loadCandidates()
  })
}

export default function Panel() {
  return read(selected) ? detailView() : listView()
}
