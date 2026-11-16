// What a task's pull requests can do together, in a task card and in a pull request's "same task"
// card: merge in order, check the task out in every repo (or go back), review, open the task.
import { Button, read, Row, shell, Stack, Text } from 'orca'
import type { MergeDefaults, PrSummary, ProjectPrs } from '../protocol'
import { isReady, methodFor, waitsOutside, type PrGroup } from '../shared/group'
import { waitsLine } from './parts'
import { ask, busy, checkout, mergeInOrder, prName, reviewWithAgent } from './state'

const branchOf = (data: ProjectPrs, pr: PrSummary): string | null =>
  data.repos.find((r) => r.repo.slug === pr.repo)?.repo.branch ?? null

export function confirmTaskMerge(group: PrGroup, defaults: MergeDefaults): void {
  const prs = group.prs.filter((pr) => !pr.draft)
  const method = methodFor(prs[0], defaults)
  const notReady = prs.filter((pr) => !isReady(pr)).map(prName)
  ask({
    title: `Merge ${group.label}?`,
    body:
      `${prs.map(prName).join(' → ')}, in this order, ${method}` +
      `${defaults.deleteBranch ? ', deleting feature branches' : ''}. One at a time; it stops at the first that fails.` +
      (notReady.length ? ` Not ready yet: ${notReady.join(', ')}.` : '') +
      (prs.length < group.prs.length ? ' Drafts are left out.' : ''),
    label: `Merge ${prs.length}`,
    tone: notReady.length ? 'warning' : 'success',
    run: () => mergeInOrder(group.label, prs, method, defaults.deleteBranch)
  })
}

function confirmCheckout(group: PrGroup, data: ProjectPrs, back: boolean): void {
  const items = group.prs.map((pr) => ({ repo: pr.repo, branch: back ? pr.base : pr.head, name: pr.repoLabel }))
  ask({
    title: back ? `Switch back from ${group.label}?` : `Check out ${group.label}?`,
    body:
      `${items.map((i) => `${i.name} → ${i.branch}`).join(', ')}. Each repo fetches its branch first; ` +
      'a repo with uncommitted changes is left as it is.',
    label: back ? 'Switch back' : 'Check out',
    tone: 'accent',
    run: () => checkout(items, back ? 'Switching back…' : `Checking out ${group.label}…`)
  })
}

/** The task's buttons, and why merging waits when it does. */
export function taskActions(group: PrGroup, data: ProjectPrs, merging = true) {
  const running = !!read(busy)
  const open = group.prs.filter((pr) => !pr.draft)
  const blocked = waitsOutside(open)
  const onTask = group.prs.every((pr) => branchOf(data, pr) === pr.head)
  const base = [...new Set(group.prs.map((pr) => pr.base))].join('/')
  return (
    <Stack gap="xs">
      {blocked.length > 0 ? (
        <Text size="sm" tone="warning">
          {`${waitsLine(blocked)}, still open. Merge that first.`}
        </Text>
      ) : null}
      <Row gap="xs" wrap>
        {merging ? (
          <Button
            size="sm"
            variant="outline"
            tone="success"
            icon="check"
            disabled={running || open.length === 0 || blocked.length > 0}
            tooltip={
              blocked.length > 0
                ? 'Waits for a pull request outside this task'
                : 'Merge each one in repo order (backend first), after the ones it waits for'
            }
            onPress={() => confirmTaskMerge(group, data.defaults)}
          >
            {`Merge ${open.length} in order`}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          icon="branch"
          disabled={running}
          tooltip={onTask ? `Every repo is on this task's branch; switch them back to ${base}` : 'Switch every repo to this task\'s branch'}
          onPress={() => confirmCheckout(group, data, onTask)}
        >
          {onTask ? `Back to ${base}` : 'Check out'}
        </Button>
        <Button size="sm" variant="ghost" icon="agent" disabled={running} onPress={() => reviewWithAgent(group.prs)}>
          {`Review with ${data.defaults.agent || 'agent'}`}
        </Button>
        {group.taskUrl ? (
          <Button size="sm" variant="ghost" icon="open-external" onPress={() => shell.openExternal(group.taskUrl as string)}>
            Task
          </Button>
        ) : null}
      </Row>
    </Stack>
  )
}

/** `Task 42 · Gift cards at checkout`, or the label alone. */
export const taskTitle = (group: PrGroup): string => (group.taskTitle ? `${group.label} · ${group.taskTitle}` : group.label)

/** `feat/x · merge order: be → admin`. */
export function taskLine(group: PrGroup): string {
  const order = group.prs.length > 1 ? ` · merge order: ${group.prs.map((pr) => pr.repoLabel).join(' → ')}` : ''
  return `${group.branch ?? 'several branches'}${order}`
}
