// One pull request: what it is and where it stands, its checks, the same task's pull requests in
// other repos, one card of actions, the review box, then description, files with diffs and the
// conversation.
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  CodeView,
  Collapsible,
  Heading,
  IconButton,
  KeyValue,
  List,
  ListItem,
  Markdown,
  read,
  RelativeTime,
  Row,
  Select,
  Separator,
  set,
  shell,
  Skeleton,
  Spinner,
  Stack,
  Table,
  Text,
  Textarea
} from 'orca'
import type { MergeDefaults, MergeMethod, PrDetail, PrSummary, ProjectPrs } from '../protocol'
import { groupKey, groupPrs, isReady, methodFor } from '../shared/group'
import { checksLine, checksTone, mergeLine, reviewLook } from '../shared/look'
import { confirmBox, noticeBox, prItem, prLabel } from './parts'
import {
  actOn,
  allPrs,
  ask,
  back,
  busy,
  deleteChoice,
  detail,
  detailError,
  detailLoading,
  diffError,
  diffLoading,
  diffPatch,
  diffPath,
  draft,
  list,
  loadDetail,
  methodChoice,
  openDiff,
  prName,
  reviewWithAgent,
  selected
} from './state'
import { taskActions, taskLine } from './task'

const METHODS: readonly { value: MergeMethod; label: string }[] = [
  { value: 'squash', label: 'Squash and merge' },
  { value: 'merge', label: 'Create a merge commit' },
  { value: 'rebase', label: 'Rebase and merge' }
]

const REVIEW_STATE: Record<string, string> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'requested changes',
  COMMENTED: 'commented',
  DISMISSED: 'review dismissed'
}

const FALLBACK_DEFAULTS: MergeDefaults = {
  mergeMethod: 'squash',
  releaseBranch: 'main',
  releaseMergeMethod: 'merge',
  developBranch: 'development',
  deleteBranch: true,
  keepBranches: ['main', 'master', 'development', 'develop'],
  mergeOrder: ['be'],
  agent: '',
  refreshMinutes: 3
}

function header(pr: PrSummary) {
  return (
    <Row justify="between" align="center">
      <Button variant="ghost" size="sm" onPress={back}>
        ← All pull requests
      </Button>
      <Row gap="xs">
        <Button
          variant="ghost"
          size="sm"
          icon="refresh"
          disabled={read(detailLoading)}
          tooltip="Fetch this pull request again"
          onPress={() => loadDetail()}
        >
          Refresh
        </Button>
        <Button variant="ghost" size="sm" icon="open-external" onPress={() => shell.openExternal(pr.url)}>
          GitHub
        </Button>
      </Row>
    </Row>
  )
}

function titleBlock(d: PrSummary & { state?: string }) {
  const state = d.state ?? 'OPEN'
  const stateTone = state === 'OPEN' ? 'success' : state === 'MERGED' ? 'accent' : 'danger'
  return (
    <Stack gap="xs">
      <Heading level={2}>{d.headline}</Heading>
      <Row gap="xs" wrap align="center">
        <Badge tone={stateTone}>{d.draft && state === 'OPEN' ? 'Draft' : state.charAt(0) + state.slice(1).toLowerCase()}</Badge>
        <Badge>{prName(d)}</Badge>
        {d.kind ? <Badge tone="neutral">{d.kind}</Badge> : null}
        {d.autoMerge ? <Badge tone="accent">Auto-merge on</Badge> : null}
        {d.labels.map((label) => (
          <Badge key={label} tone="neutral">
            {label}
          </Badge>
        ))}
      </Row>
    </Stack>
  )
}

function facts(d: PrDetail) {
  const review = reviewLook(d.reviewDecision)
  const reviewers = d.reviewers.map((r) => `${r.login} (${REVIEW_STATE[r.state] ?? r.state.toLowerCase()})`).join(', ')
  return (
    <KeyValue
      items={[
        ...(d.task ? [{ label: 'Task', value: d.taskTitle ? `${d.task} · ${d.taskTitle}` : d.task }] : []),
        { label: 'Repository', value: d.repo },
        ...(d.waitsFor.length
          ? [{ label: 'Waits for', value: `${d.waitsFor.map(prLabel).join(', ')} (still open)`, tone: 'warning' as const }]
          : []),
        { label: 'Branch', value: `${d.head} → ${d.base}`, code: true },
        { label: 'Author', value: d.author },
        { label: 'Review', value: review?.text ?? 'No review required', tone: review?.tone },
        ...(reviewers ? [{ label: 'Reviewers', value: reviewers }] : []),
        { label: 'Checks', value: checksLine(d.checks), tone: checksTone(d.checks) },
        {
          label: 'Merge',
          value: mergeLine(d),
          tone: d.mergeable === 'CONFLICTING' ? ('danger' as const) : d.mergeState === 'CLEAN' ? ('success' as const) : undefined
        },
        { label: 'Changes', value: `+${d.additions} −${d.deletions} in ${d.changedFiles} file${d.changedFiles === 1 ? '' : 's'}` }
      ]}
    />
  )
}

const CHECK_ICON = { passed: 'check', failed: 'close', pending: 'pause', skipped: 'remove', 'not-run': 'warning' } as const
const CHECK_TEXT = { passed: 'passed', failed: 'failed', pending: 'pending', skipped: 'skipped', 'not-run': "didn't run" } as const

function checksSection(d: PrDetail) {
  if (d.checkRuns.length === 0) return null
  const rank = { failed: 0, 'not-run': 1, pending: 2, passed: 3, skipped: 4 } as const
  const ordered = [...d.checkRuns].sort((a, b) => rank[a.state] - rank[b.state])
  const open = d.checks.failed > 0 || d.checks.notRun > 0
  return (
    <Collapsible title={`Checks (${d.checkRuns.length})`} description={checksLine(d.checks)} defaultOpen={open}>
      <List label="Checks">
        {ordered.map((c, i) => (
          <ListItem
            key={`${c.name}-${i}`}
            title={c.name}
            description={c.note ? `${CHECK_TEXT[c.state]}: ${c.note}` : CHECK_TEXT[c.state]}
            icon={CHECK_ICON[c.state]}
            disabled={!c.url}
            onPress={c.url ? () => shell.openExternal(c.url as string) : undefined}
          />
        ))}
      </List>
    </Collapsible>
  )
}

function siblingsOf(pr: PrSummary): PrSummary[] {
  const key = groupKey(pr)
  return allPrs().filter((other) => other.key !== pr.key && groupKey(other) === key)
}

function siblingsCard(d: PrDetail, siblings: PrSummary[], data: ProjectPrs | null) {
  if (siblings.length === 0 || !data) return null
  const group = groupPrs([d, ...siblings], data.defaults.mergeOrder)[0]
  return (
    <Card title={`Same ${d.task ? 'task' : 'branch'} in other repos`} description={taskLine(group)}>
      <Stack gap="xs">
        <List label="Related pull requests">{siblings.map((pr) => prItem(pr, 'card'))}</List>
        {taskActions(group, data, d.state === 'OPEN')}
      </Stack>
    </Card>
  )
}

/** Why merging this one alone now would go against the order: what it waits for, and the same
 *  task's pull requests that merge before it (backend first). */
function orderWarnings(d: PrDetail, siblings: PrSummary[], defaults: MergeDefaults): { waits: string; earlier: string } {
  const sequence = groupPrs([d, ...siblings], defaults.mergeOrder)[0].prs
  const before = sequence.slice(0, sequence.findIndex((pr) => pr.key === d.key)).filter((pr) => !pr.draft)
  return {
    waits: d.waitsFor.length ? `It waits for ${d.waitsFor.map(prLabel).join(', ')}, still open.` : '',
    earlier: before.length ? `${before.map(prName).join(', ')} of the same task merge${before.length === 1 ? 's' : ''} first.` : ''
  }
}

function stateButtons(d: PrDetail, running: boolean) {
  return (
    <Row gap="xs" wrap>
      {d.draft ? (
        <Button size="sm" variant="outline" disabled={running} onPress={() => actOn(d, 'ready')}>
          Ready for review
        </Button>
      ) : (
        <Button size="sm" variant="ghost" disabled={running} onPress={() => actOn(d, 'draft')}>
          Convert to draft
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        tone="danger"
        disabled={running}
        onPress={() =>
          ask({
            title: `Close ${prName(d)}?`,
            body: 'It closes without merging; you can reopen it later.',
            label: 'Close',
            tone: 'danger',
            run: () => actOn(d, 'close')
          })
        }
      >
        Close
      </Button>
    </Row>
  )
}

function actionsCard(d: PrDetail, siblings: PrSummary[], defaults: MergeDefaults) {
  const running = !!read(busy)
  if (d.state === 'MERGED') return null
  if (d.state !== 'OPEN') {
    return (
      <Card title="Actions">
        <Row gap="xs">
          <Button size="sm" variant="outline" disabled={running} onPress={() => actOn(d, 'reopen')}>
            Reopen
          </Button>
        </Row>
      </Card>
    )
  }
  const { waits, earlier } = orderWarnings(d, siblings, defaults)
  const method = read(methodChoice) ?? methodFor(d, defaults)
  const methodLabel = METHODS.find((m) => m.value === method)?.label ?? method
  const kept = defaults.keepBranches.includes(d.head.toLowerCase())
  const remove = !kept && (read(deleteChoice) ?? defaults.deleteBranch)
  const outOfOrder = waits || earlier
  return (
    <Card title="Actions">
      <Stack gap="xs">
        <Select
          label="Merge method"
          labelHidden
          value={method}
          options={METHODS}
          onChange={(value) => set(methodChoice, value as MergeMethod)}
        />
        <Checkbox
          label={`Delete ${d.head} after merging`}
          description={kept ? 'A long-lived branch: never deleted' : undefined}
          checked={remove}
          disabled={kept}
          onChange={(value) => set(deleteChoice, value)}
        />
        <Row gap="xs" wrap>
          <Button
            tone="success"
            icon="check"
            disabled={running || d.draft}
            tooltip={d.draft ? 'Mark it ready for review first' : undefined}
            onPress={() =>
              ask({
                title: `Merge ${prName(d)}?`,
                body:
                  `${methodLabel} into ${d.base}${remove ? `, then delete ${d.head}` : ''}.` +
                  (waits ? ` ${waits}` : '') +
                  (earlier ? ` ${earlier}` : '') +
                  (d.checks.failed || d.checks.pending || d.checks.notRun || d.mergeable === 'CONFLICTING'
                    ? ` Not everything is green: ${mergeLine(d)}, ${checksLine(d.checks)}.`
                    : '') +
                  (d.flags.length ? ` Heads-up: ${d.flags.join('; ')}.` : ''),
                label: outOfOrder ? 'Merge anyway' : 'Merge',
                tone: waits ? 'danger' : isReady(d) && !earlier && d.flags.length === 0 ? 'success' : 'warning',
                run: () => actOn(d, 'merge', { method, deleteBranch: remove, sha: d.headSha })
              })
            }
          >
            Merge
          </Button>
          {d.autoMerge ? (
            <Button variant="outline" icon="stop" disabled={running} onPress={() => actOn(d, 'cancel-auto-merge')}>
              Cancel auto-merge
            </Button>
          ) : (
            <Button
              variant="outline"
              icon="play"
              disabled={running || d.draft || !!outOfOrder}
              tooltip={
                outOfOrder
                  ? 'It would merge out of order: merge what comes first, then turn this on'
                  : 'GitHub merges it once its required checks pass'
              }
              onPress={() =>
                ask({
                  title: `Merge ${prName(d)} when green?`,
                  body:
                    `GitHub merges it (${methodLabel.toLowerCase()}) once its required checks pass${remove ? `, then deletes ${d.head}` : ''}. ` +
                    'New commits on the branch cancel it. The repo must allow auto-merge.',
                  label: 'Turn on auto-merge',
                  tone: 'accent',
                  run: () => actOn(d, 'auto-merge', { method, deleteBranch: remove, sha: d.headSha })
                })
              }
            >
              Merge when green
            </Button>
          )}
          {d.mergeState === 'BEHIND' ? (
            <Button variant="outline" icon="refresh" disabled={running} onPress={() => actOn(d, 'update-branch')}>
              Update branch
            </Button>
          ) : null}
        </Row>
        <Separator />
        {stateButtons(d, running)}
      </Stack>
    </Card>
  )
}

function reviewCard(d: PrDetail, siblings: PrSummary[], defaults: MergeDefaults) {
  const text = read(draft)
  const running = !!read(busy)
  const open = d.state === 'OPEN'
  return (
    <Card title="Review">
      <Stack gap="xs">
        <Textarea
          label="Comment"
          labelHidden
          rows={4}
          placeholder="Leave a comment, or a review with Approve / Request changes"
          value={text}
          onChange={(value) => set(draft, value)}
        />
        <Row gap="xs" wrap>
          <Button size="sm" icon="edit" disabled={running || !text.trim()} onPress={() => actOn(d, 'comment', { body: text })}>
            Comment
          </Button>
          {!d.mine && open ? (
            <Button size="sm" variant="outline" tone="success" icon="check" disabled={running} onPress={() => actOn(d, 'approve', { body: text })}>
              Approve
            </Button>
          ) : null}
          {!d.mine && open ? (
            <Button
              size="sm"
              variant="outline"
              tone="danger"
              disabled={running || !text.trim()}
              tooltip="Write what needs to change first"
              onPress={() => actOn(d, 'request-changes', { body: text })}
            >
              Request changes
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" icon="agent" disabled={running} onPress={() => reviewWithAgent([d, ...siblings])}>
            {`Review with ${defaults.agent || 'agent'}`}
          </Button>
        </Row>
      </Stack>
    </Card>
  )
}

function diffBlock() {
  const path = read(diffPath)
  if (!path) return null
  const patch = read(diffPatch)
  const error = read(diffError)
  return (
    <Stack gap="xs">
      <Row justify="between" align="center">
        <Text size="sm" weight="medium" truncate>
          {path}
        </Text>
        <IconButton icon="close" label="Close the diff" size="sm" variant="ghost" onPress={() => openDiff(null)} />
      </Row>
      {read(diffLoading) && !patch ? <Spinner label="Loading the diff" /> : null}
      {error ? <Callout tone="neutral" icon="info">{error}</Callout> : null}
      {patch ? <CodeView code={patch.text} language="diff" label={path} maxHeight="lg" /> : null}
      {patch?.truncated ? (
        <Text size="xs" muted>
          Cut to fit the panel; open it on GitHub for the rest.
        </Text>
      ) : null}
    </Stack>
  )
}

function filesSection(d: PrDetail) {
  if (d.files.length === 0) return null
  const open = read(diffPath)
  return (
    <Collapsible title={`Files (${d.changedFiles})`} description={`+${d.additions} −${d.deletions} · pick one to see its diff`} defaultOpen={!!open}>
      <Stack gap="xs">
        <Table
          label="Changed files"
          maxHeight="md"
          selectionMode="single"
          selected={open ? [open] : []}
          onSelectionChange={({ keys }) => void openDiff(keys[0] ?? null)}
          columns={[
            { key: 'path', label: 'File' },
            { key: 'add', label: '+', align: 'end', width: 'xs' },
            { key: 'del', label: '−', align: 'end', width: 'xs' }
          ]}
          rows={d.files.map((f) => ({ key: f.path, cells: { path: f.path, add: f.additions, del: f.deletions } }))}
        />
        {diffBlock()}
      </Stack>
    </Collapsible>
  )
}

function conversation(d: PrDetail) {
  if (d.timeline.length === 0) return null
  return (
    <Collapsible title={`Conversation (${d.timeline.length})`}>
      <Stack gap="xs">
        {d.timeline.map((item, i) => (
          <Card
            key={`${item.at}-${i}`}
            title={item.kind === 'review' ? `${item.author} ${REVIEW_STATE[item.state ?? ''] ?? 'reviewed'}` : item.author}
          >
            <Stack gap="xs">
              <Text muted size="xs">
                <RelativeTime at={item.at} muted />
              </Text>
              {item.body ? <Markdown content={item.body} /> : null}
            </Stack>
          </Card>
        ))}
      </Stack>
    </Collapsible>
  )
}

export function detailView() {
  const key = read(selected)
  // The worker resolves what a pull request waits for across the project's list; the detail
  // alone cannot, so it takes the list's answer.
  const fetched = read(detail)
  const listed = allPrs().find((pr) => pr.key === key)
  const d = fetched && listed ? { ...fetched, waitsFor: listed.waitsFor } : fetched
  const summary = listed ?? d
  const error = read(detailError)
  const data = read(list)
  const defaults = data?.defaults ?? FALLBACK_DEFAULTS
  if (!summary) return null
  if (!d || d.key !== key) {
    return (
      <Stack gap="sm">
        {header(summary)}
        {titleBlock(summary)}
        {error ? <Callout tone="danger" icon="error">{error}</Callout> : <Skeleton lines={8} label="Loading the pull request" />}
      </Stack>
    )
  }
  const siblings = siblingsOf(d)
  return (
    <Stack gap="sm">
      {header(d)}
      {titleBlock(d)}
      {noticeBox()}
      {confirmBox()}
      {error ? <Callout tone="danger" icon="error">{error}</Callout> : null}
      {d.flags.map((flag) => (
        <Callout key={flag} tone="warning" icon="warning">
          {flag}
        </Callout>
      ))}
      {facts(d)}
      {checksSection(d)}
      {siblingsCard(d, siblings, data)}
      {actionsCard(d, siblings, defaults)}
      {reviewCard(d, siblings, defaults)}
      <Collapsible title="Description" defaultOpen>
        <Markdown content={d.body || '_No description._'} />
      </Collapsible>
      {filesSection(d)}
      {conversation(d)}
    </Stack>
  )
}
