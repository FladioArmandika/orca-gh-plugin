// The list side of the panel: project picker, filters, and the By task / By repo / New PR /
// Release tabs.
import {
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Collapsible,
  EmptyState,
  IconButton,
  Input,
  List,
  read,
  Row,
  Select,
  set,
  Skeleton,
  Spinner,
  Stack,
  Switch,
  Tab,
  Tabs,
  Text
} from 'orca'
import type { NewPrCandidate, PrSummary, ProjectPrs } from '../protocol'
import { byMergeOrder, FILTERS, groupPrs, isReady, matches, needsAttention, type PrFilter, type PrGroup } from '../shared/group'
import { confirmBox, noticeBox, prItem } from './parts'
import { releaseView } from './release'
import {
  allPrs,
  ask,
  busy,
  candidates,
  candidatesError,
  candidatesLoading,
  choice,
  createPrs,
  filter,
  focusedProjectId,
  hideDrafts,
  list,
  listLoading,
  loadList,
  pickProject,
  pickView,
  projects,
  query,
  view
} from './state'
import { taskActions, taskLine, taskTitle } from './task'

const FOCUSED = '__focused__'

function visiblePrs(data: ProjectPrs | null): PrSummary[] {
  const f = read(filter)
  const drafts = read(hideDrafts)
  const q = read(query)
  return allPrs(data).filter((pr) => matches(pr, f, drafts, q))
}

function projectPicker() {
  const all = read(projects)
  const focused = all.find((p) => p.id === read(focusedProjectId))
  // A Select option cannot have an empty value: FOCUSED stands for "follow the focus" ('').
  const options = [
    { value: FOCUSED, label: focused ? `Focused: ${focused.name}` : 'Focused project' },
    ...all.map((p) => ({ value: p.id, label: p.name }))
  ]
  return (
    <Row gap="xs" align="end">
      <Box grow>
        <Select
          label="Project"
          labelHidden
          value={read(choice) || FOCUSED}
          options={options}
          onChange={(value) => pickProject(value === FOCUSED ? '' : value)}
        />
      </Box>
      <IconButton
        icon="refresh"
        label="Refresh"
        tooltip="Fetch every repo's pull requests again"
        disabled={read(listLoading)}
        onPress={() => loadList(true)}
      />
    </Row>
  )
}

function summary(data: ProjectPrs) {
  const prs = allPrs(data)
  const review = prs.filter((pr) => pr.reviewRequestedFromMe).length
  const ready = prs.filter(isReady).length
  const attention = prs.filter(needsAttention).length
  const repos = data.repos.filter((r) => r.repo.slug).length
  return (
    <Row gap="xs" wrap align="center">
      <Badge>{`${prs.length} open`}</Badge>
      {review > 0 ? <Badge tone="accent">{`${review} to review`}</Badge> : null}
      {ready > 0 ? <Badge tone="success">{`${ready} ready`}</Badge> : null}
      {attention > 0 ? <Badge tone="danger">{`${attention} need${attention === 1 ? 's' : ''} attention`}</Badge> : null}
      <Text muted size="xs">{`${repos} repo${repos === 1 ? '' : 's'} in ${data.project?.name ?? ''}`}</Text>
    </Row>
  )
}

/** Checks GitHub never started (a spending limit, a failed payment): once for the project,
 *  in GitHub's words, rather than as a red badge on every row. */
function ciNotice(data: ProjectPrs) {
  const prs = allPrs(data).filter((pr) => pr.checks.notRun > 0)
  if (!data.ciNote || prs.length === 0) return null
  return (
    <Callout tone="warning" icon="warning" title={`Checks didn't run on ${prs.length} pull request${prs.length === 1 ? '' : 's'}`}>
      {data.ciNote}
    </Callout>
  )
}

function filters() {
  return (
    <Stack gap="xs">
      <Input
        label="Search"
        labelHidden
        type="search"
        placeholder="Search title, branch, author, task"
        value={read(query)}
        onChange={(value) => set(query, value)}
      />
      <Row gap="sm" align="center">
        <Box grow>
          <Select
            label="Show"
            labelHidden
            value={read(filter)}
            options={FILTERS}
            onChange={(value) => set(filter, value as PrFilter)}
          />
        </Box>
        <Switch label="Hide drafts" checked={read(hideDrafts)} onChange={(value) => set(hideDrafts, value)} />
      </Row>
    </Stack>
  )
}

function groupCard(group: PrGroup, data: ProjectPrs) {
  return (
    <Card key={group.key} title={taskTitle(group)} description={taskLine(group)}>
      <Stack gap="xs">
        <List label={group.label}>{group.prs.map((pr) => prItem(pr, 'card'))}</List>
        {taskActions(group, data)}
      </Stack>
    </Card>
  )
}

function byTask(data: ProjectPrs, prs: PrSummary[]) {
  const groups = groupPrs(prs, data.defaults.mergeOrder)
  const multi = groups.filter((g) => g.prs.length > 1)
  const single = groups.filter((g) => g.prs.length === 1).map((g) => g.prs[0])
  if (groups.length === 0) return emptyList(data)
  return (
    <Stack gap="md">
      {multi.length > 0 ? (
        <Stack gap="sm">
          <Text weight="semibold" size="sm">{`Across repos (${multi.length})`}</Text>
          {multi.map((g) => groupCard(g, data))}
        </Stack>
      ) : null}
      {single.length > 0 ? (
        <Stack gap="xs">
          <Text weight="semibold" size="sm">{`Single repo (${single.length})`}</Text>
          <List label="Single repo">{single.map((pr) => prItem(pr, 'list'))}</List>
        </Stack>
      ) : null}
    </Stack>
  )
}

function byRepo(data: ProjectPrs, prs: PrSummary[]) {
  return (
    <Stack gap="xs">
      {byMergeOrder(
        data.repos.map((r) => ({ ...r, repoName: r.repo.name })),
        data.defaults.mergeOrder
      ).map(({ repo, error }) => {
        const mine = prs.filter((pr) => pr.repo === repo.slug)
        const where = `${repo.slug ?? 'no GitHub remote'}${repo.branch ? ` · on ${repo.branch}` : ''}`
        return (
          <Collapsible key={repo.path} title={`${repo.short} (${mine.length})`} description={where} defaultOpen={mine.length > 0}>
            {error ? (
              <Callout tone={repo.slug ? 'danger' : 'neutral'} icon={repo.slug ? 'error' : 'info'}>
                {error}
              </Callout>
            ) : mine.length > 0 ? (
              <List label={repo.short}>{mine.map((pr) => prItem(pr, 'repo'))}</List>
            ) : (
              <Text muted size="sm">
                No open pull requests here.
              </Text>
            )}
          </Collapsible>
        )
      })}
    </Stack>
  )
}

function aheadLine(c: NewPrCandidate): string {
  const ahead = c.ahead === null ? `Ahead of ${c.base}` : `${c.ahead} commit${c.ahead === 1 ? '' : 's'} ahead of ${c.base}`
  const pushed = c.unpushed === null ? 'not pushed yet' : c.unpushed > 0 ? `${c.unpushed} to push` : 'pushed'
  return `${ahead} · ${pushed}`
}

function confirmCreate(items: NewPrCandidate[], asDraft: boolean) {
  const names = items.map((c) => c.repo.short).join(', ')
  const pushes = items.some((c) => c.unpushed !== 0)
  ask({
    title: items.length > 1 ? `Open ${items.length} pull requests?` : `Open a pull request in ${names}?`,
    body:
      `${items.map((c) => `${c.repo.short}: ${c.branch} → ${c.base}`).join('; ')}.` +
      (pushes ? ' Branches with unpushed commits are pushed first.' : '') +
      ' Title and description come from the commits (gh --fill); edit them on GitHub after.' +
      (items.some((c) => c.dirty) ? ' Uncommitted changes stay out.' : ''),
    label: asDraft ? 'Open as draft' : 'Open',
    tone: 'accent',
    run: () => createPrs(items, asDraft)
  })
}

function newPrs() {
  const items = read(candidates)
  const error = read(candidatesError)
  if (read(candidatesLoading) && !items) return <Spinner label="Looking at each repo's branch" />
  if (error && !items?.length) return <Callout tone="danger" icon="error">{error}</Callout>
  if (!items || items.length === 0) {
    return (
      <EmptyState
        icon="branch"
        title="Nothing to open"
        description="Every repo is on its base branch, has no new commits, or already has a pull request for its branch."
      />
    )
  }
  const byBranch = new Map<string, NewPrCandidate[]>()
  for (const c of items) byBranch.set(c.branch, [...(byBranch.get(c.branch) ?? []), c])
  const shared = [...byBranch.entries()].filter(([, group]) => group.length > 1)
  return (
    <Stack gap="sm">
      {shared.map(([branch, group]) => (
        <Button key={branch} icon="add" disabled={!!read(busy)} onPress={() => confirmCreate(group, false)}>
          {`Open PRs for ${branch} in ${group.length} repos`}
        </Button>
      ))}
      {items.map((c) => (
        <Card key={c.repo.path} title={c.repo.short} description={`${c.branch} → ${c.base}`}>
          <Stack gap="xs">
            <Text size="sm" muted>
              {aheadLine(c)}
            </Text>
            {c.dirty ? (
              <Text size="sm" tone="warning">
                Has uncommitted changes; they stay out of the pull request.
              </Text>
            ) : null}
            <Row gap="xs">
              <Button size="sm" icon="add" disabled={!!read(busy)} onPress={() => confirmCreate([c], false)}>
                Open PR
              </Button>
              <Button size="sm" variant="ghost" disabled={!!read(busy)} onPress={() => confirmCreate([c], true)}>
                Open as draft
              </Button>
            </Row>
          </Stack>
        </Card>
      ))}
    </Stack>
  )
}

function emptyList(data: ProjectPrs) {
  const anyOpen = allPrs(data).length > 0
  return (
    <EmptyState
      icon={anyOpen ? 'filter' : 'check'}
      title={anyOpen ? 'No pull requests match' : 'No open pull requests'}
      description={anyOpen ? 'Change the filter or the search.' : `Nothing open in ${data.project?.name ?? 'this project'}'s repos.`}
    />
  )
}

function body(data: ProjectPrs | null) {
  if (!data) {
    return read(listLoading) ? <Skeleton lines={6} label="Loading pull requests" /> : null
  }
  if (data.error) {
    return (
      <Callout tone="danger" title="GitHub is out of reach" icon="error">
        {data.error}
      </Callout>
    )
  }
  if (!data.project) {
    return <EmptyState icon="folder" title="No project" description="Focus a workspace in Orca, or pick a project above." />
  }
  if (data.repos.length === 0) {
    return (
      <EmptyState
        icon="folder"
        title="No Git repositories here"
        description={`Nothing under ${data.project.path} has a .git folder. Repos are looked for up to the folder depth set in the plugin's settings.`}
      />
    )
  }
  if (data.repos.every((r) => !r.repo.slug)) {
    const n = data.repos.length
    return (
      <EmptyState
        icon="folder"
        title="No GitHub repositories here"
        description={`Found ${n} Git repo${n === 1 ? '' : 's'} under ${data.project.path}, none pushing to github.com. Pick another project above.`}
      />
    )
  }
  const prs = visiblePrs(data)
  const current = read(view)
  return (
    <Tabs label="View" value={current} onChange={pickView}>
      <Tab value="task" label="By task" icon="layers">
        {current === 'task' ? byTask(data, prs) : null}
      </Tab>
      <Tab value="repo" label="By repo" icon="folder">
        {current === 'repo' ? (prs.length || allPrs(data).length === 0 ? byRepo(data, prs) : emptyList(data)) : null}
      </Tab>
      <Tab value="new" label="New PR" icon="add">
        {current === 'new' ? newPrs() : null}
      </Tab>
      <Tab value="release" label="Release" icon="rocket">
        {current === 'release' ? releaseView(data) : null}
      </Tab>
    </Tabs>
  )
}

export function listView() {
  const data = read(list)
  const github = !!data?.project && !data.error && data.repos.some((r) => r.repo.slug)
  const current = read(view)
  return (
    <Stack gap="sm">
      {projectPicker()}
      {github && data ? summary(data) : null}
      {github && data ? ciNotice(data) : null}
      {github && (current === 'task' || current === 'repo') ? filters() : null}
      {noticeBox()}
      {confirmBox()}
      {body(data)}
    </Stack>
  )
}
