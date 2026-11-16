// One pull request: its state, merge box, review box, sibling PRs of the same task, checks,
// files, description and conversation.
import {
  Badge,
  Button,
  Callout,
  Card,
  Checkbox,
  Collapsible,
  Heading,
  KeyValue,
  List,
  ListItem,
  Markdown,
  read,
  RelativeTime,
  Row,
  Select,
  set,
  shell,
  Skeleton,
  Stack,
  Table,
  Text,
  Textarea
} from 'orca'
import type { MergeDefaults, MergeMethod, PrDetail, PrSummary } from '../protocol'
import { groupKey, groupPrs, isReady, methodFor } from '../shared/group'
import { checksLine, mergeLine, reviewLook } from '../shared/look'
import { confirmBox, noticeBox, prItem } from './parts'
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
  draft,
  list,
  loadDetail,
  mergeGroup,
  methodChoice,
  reviewWithAgent,
  selected
} from './state'

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
  deleteBranch: true,
  keepBranches: ['main', 'master', 'development', 'develop'],
  mergeOrder: ['be'],
  agent: ''
}

function header(pr: PrSummary | PrDetail) {
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

function facts(d: PrDetail) {
  const review = reviewLook(d.reviewDecision)
  const reviewers = d.reviewers.map((r) => `${r.login} (${REVIEW_STATE[r.state] ?? r.state.toLowerCase()})`).join(', ')
  return (
    <KeyValue
      items={[
        { label: 'Repository', value: `${d.repoName} · ${d.repo}`, code: false },
        { label: 'Branch', value: `${d.head} → ${d.base}`, code: true },
        { label: 'Author', value: d.author },
        { label: 'Review', value: review?.text ?? 'No review required', tone: review?.tone },
        ...(reviewers ? [{ label: 'Reviewers', value: reviewers }] : []),
        {
          label: 'Checks',
          value: checksLine(d.checks),
          tone: d.checks.failed ? 'danger' : d.checks.pending ? 'warning' : d.checks.total ? 'success' : undefined
        },
        {
          label: 'Merge',
          value: mergeLine(d),
          tone: d.mergeable === 'CONFLICTING' ? 'danger' : d.mergeState === 'CLEAN' ? 'success' : undefined
        },
        { label: 'Changes', value: `+${d.additions} −${d.deletions} in ${d.changedFiles} file${d.changedFiles === 1 ? '' : 's'}` }
      ]}
    />
  )
}

function siblingsOf(pr: PrSummary): PrSummary[] {
  const key = groupKey(pr)
  return allPrs().filter((other) => other.key !== pr.key && groupKey(other) === key)
}

function siblingsCard(d: PrDetail, siblings: PrSummary[], defaults: MergeDefaults) {
  if (siblings.length === 0) return null
  const all = [d, ...siblings]
  const group = groupPrs(all, defaults.mergeOrder)[0]
  const open = group.prs.filter((pr) => !pr.draft)
  const method = methodFor(d, defaults)
  return (
    <Card title={`Same ${d.task ? `task (${d.task})` : 'branch'} in other repos`} description={`Merge order: ${group.prs.map((p) => p.repoName).join(' → ')}`}>
      <Stack gap="xs">
        <List label="Related pull requests">{siblings.map((pr) => prItem(pr, true))}</List>
        <Row gap="xs" wrap>
          <Button
            size="sm"
            variant="outline"
            tone="success"
            icon="check"
            disabled={!!read(busy) || d.state !== 'OPEN' || open.length === 0}
            onPress={() =>
              ask({
                title: `Merge all ${open.length} in order?`,
                body:
                  `${open.map((pr) => `${pr.repoName}#${pr.number}`).join(' → ')}, ${method}` +
                  `${defaults.deleteBranch ? ', deleting feature branches' : ''}. Stops at the first that fails.` +
                  (open.some((pr) => !isReady(pr)) ? ' Some are not ready yet.' : ''),
                label: `Merge ${open.length}`,
                tone: open.every(isReady) ? 'success' : 'warning',
                run: () => mergeGroup(group, open, method, defaults.deleteBranch)
              })
            }
          >
            {`Merge all ${open.length} in order`}
          </Button>
          <Button size="sm" variant="ghost" icon="agent" disabled={!!read(busy)} onPress={() => reviewWithAgent(group.prs)}>
            {`Review all with ${defaults.agent || 'agent'}`}
          </Button>
        </Row>
      </Stack>
    </Card>
  )
}

function mergeCard(d: PrDetail, defaults: MergeDefaults) {
  if (d.state !== 'OPEN') return null
  const method = read(methodChoice) ?? methodFor(d, defaults)
  const kept = defaults.keepBranches.includes(d.head.toLowerCase())
  const remove = !kept && (read(deleteChoice) ?? defaults.deleteBranch)
  const running = !!read(busy)
  return (
    <Card title="Merge">
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
                title: `Merge ${d.repoName}#${d.number}?`,
                body:
                  `${METHODS.find((m) => m.value === method)?.label} into ${d.base}${remove ? `, then delete ${d.head}` : ''}.` +
                  (isReady(d) ? '' : ` Not everything is green: ${mergeLine(d)}, ${checksLine(d.checks)}.`) +
                  (d.flags.length ? ` Heads-up: ${d.flags.join('; ')}.` : ''),
                label: 'Merge',
                tone: isReady(d) && d.flags.length === 0 ? 'success' : 'warning',
                run: () => actOn(d, 'merge', { method, deleteBranch: remove, sha: d.headSha })
              })
            }
          >
            Merge
          </Button>
          {d.mergeState === 'BEHIND' ? (
            <Button variant="outline" icon="refresh" disabled={running} onPress={() => actOn(d, 'update-branch')}>
              Update branch
            </Button>
          ) : null}
        </Row>
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

function stateActions(d: PrDetail) {
  const running = !!read(busy)
  if (d.state === 'MERGED') return null
  return (
    <Row gap="xs" wrap>
      {d.state === 'OPEN' && d.draft ? (
        <Button size="sm" variant="outline" disabled={running} onPress={() => actOn(d, 'ready')}>
          Ready for review
        </Button>
      ) : null}
      {d.state === 'OPEN' && !d.draft ? (
        <Button size="sm" variant="ghost" disabled={running} onPress={() => actOn(d, 'draft')}>
          Convert to draft
        </Button>
      ) : null}
      {d.state === 'OPEN' ? (
        <Button
          size="sm"
          variant="ghost"
          tone="danger"
          disabled={running}
          onPress={() =>
            ask({
              title: `Close ${d.repoName}#${d.number}?`,
              body: 'It closes without merging; you can reopen it later.',
              label: 'Close',
              tone: 'danger',
              run: () => actOn(d, 'close')
            })
          }
        >
          Close
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={running} onPress={() => actOn(d, 'reopen')}>
          Reopen
        </Button>
      )}
    </Row>
  )
}

const CHECK_ICON = { passed: 'check', failed: 'close', pending: 'pause', skipped: 'remove' } as const

function checksSection(d: PrDetail) {
  if (d.checkRuns.length === 0) return null
  const failing = d.checkRuns.filter((c) => c.state === 'failed')
  const ordered = [...failing, ...d.checkRuns.filter((c) => c.state !== 'failed')]
  return (
    <Collapsible title={`Checks (${d.checkRuns.length})`} description={checksLine(d.checks)} defaultOpen={failing.length > 0}>
      <List label="Checks">
        {ordered.map((c, i) => (
          <ListItem
            key={`${c.name}-${i}`}
            title={c.name}
            description={c.state}
            icon={CHECK_ICON[c.state]}
            disabled={!c.url}
            onPress={c.url ? () => shell.openExternal(c.url as string) : undefined}
          />
        ))}
      </List>
    </Collapsible>
  )
}

function filesSection(d: PrDetail) {
  if (d.files.length === 0) return null
  return (
    <Collapsible title={`Files (${d.changedFiles})`} description={`+${d.additions} −${d.deletions}`}>
      <Table
        label="Changed files"
        maxHeight="md"
        columns={[
          { key: 'path', label: 'File' },
          { key: 'add', label: '+', align: 'end', width: 'xs' },
          { key: 'del', label: '−', align: 'end', width: 'xs' }
        ]}
        rows={d.files.map((f) => ({ key: f.path, cells: { path: f.path, add: f.additions, del: f.deletions } }))}
      />
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
  const d = read(detail)
  const summary = allPrs().find((pr) => pr.key === key) ?? d
  const error = read(detailError)
  const defaults = read(list)?.defaults ?? FALLBACK_DEFAULTS
  if (!summary) return null
  if (!d || d.key !== key) {
    return (
      <Stack gap="sm">
        {header(summary)}
        <Heading level={2}>{`#${summary.number} ${summary.title}`}</Heading>
        {error ? <Callout tone="danger" icon="error">{error}</Callout> : <Skeleton lines={8} label="Loading the pull request" />}
      </Stack>
    )
  }
  const siblings = siblingsOf(d)
  const stateTone = d.state === 'OPEN' ? 'success' : d.state === 'MERGED' ? 'accent' : 'danger'
  return (
    <Stack gap="sm">
      {header(d)}
      <Heading level={2}>{d.title}</Heading>
      <Row gap="xs" wrap align="center">
        <Badge tone={stateTone}>{d.draft && d.state === 'OPEN' ? 'Draft' : d.state.toLowerCase()}</Badge>
        <Badge>{`${d.repoName}#${d.number}`}</Badge>
        {d.labels.map((label) => (
          <Badge key={label} tone="neutral">
            {label}
          </Badge>
        ))}
      </Row>
      {noticeBox()}
      {confirmBox()}
      {error ? <Callout tone="danger" icon="error">{error}</Callout> : null}
      {d.flags.map((flag) => (
        <Callout key={flag} tone="warning" icon="warning">
          {flag}
        </Callout>
      ))}
      {facts(d)}
      {siblingsCard(d, siblings, defaults)}
      {mergeCard(d, defaults)}
      {reviewCard(d, siblings, defaults)}
      {stateActions(d)}
      {checksSection(d)}
      <Collapsible title="Description" defaultOpen>
        <Markdown content={d.body || '_No description._'} />
      </Collapsible>
      {filesSection(d)}
      {conversation(d)}
    </Stack>
  )
}
