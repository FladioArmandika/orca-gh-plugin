// The list side of the panel: project picker, filters, and the By task / By repo / New PR tabs.
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
import { FILTERS, groupPrs, isReady, matches, methodFor, needsAttention, type PrFilter, type PrGroup } from '../shared/group'
import { confirmBox, noticeBox, prItem } from './parts'
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
  mergeGroup,
  pickProject,
  pickView,
  projects,
  query,
  reviewWithAgent,
  view
} from './state'

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

function confirmGroupMerge(group: PrGroup, data: ProjectPrs) {
  const prs = group.prs.filter((pr) => !pr.draft)
  const defaults = data.defaults
  const method = methodFor(prs[0], defaults)
  const warnings = prs.filter((pr) => !isReady(pr)).map((pr) => `${pr.repoName}#${pr.number}`)
  ask({
    title: `Merge ${group.label}?`,
    body:
      `${prs.map((pr) => `${pr.repoName}#${pr.number}`).join(' → ')}, in this order, ${method}` +
      `${defaults.deleteBranch ? ', deleting feature branches' : ''}. It stops at the first that fails.` +
      (warnings.length ? ` Not ready yet: ${warnings.join(', ')}.` : '') +
      (prs.length < group.prs.length ? ' Drafts are left out.' : ''),
    label: `Merge ${prs.length}`,
    tone: warnings.length ? 'warning' : 'success',
    run: () => mergeGroup(group, prs, method, defaults.deleteBranch)
  })
}

function groupCard(group: PrGroup, data: ProjectPrs) {
  const mergeable = group.prs.filter((pr) => !pr.draft)
  const order = group.prs.map((pr) => pr.repoName).join(' → ')
  return (
    <Card key={group.key} title={group.label} description={`${group.branch ?? 'several branches'} · ${order}`}>
      <Stack gap="xs">
        <List label={group.label}>{group.prs.map((pr) => prItem(pr, true))}</List>
        <Row gap="xs" wrap>
          <Button
            size="sm"
            variant="outline"
            tone="success"
            icon="check"
            disabled={!!read(busy) || mergeable.length === 0}
            tooltip="Merge each PR in the configured repo order (backend first)"
            onPress={() => confirmGroupMerge(group, data)}
          >
            {`Merge ${mergeable.length} in order`}
          </Button>
          <Button size="sm" variant="ghost" icon="agent" disabled={!!read(busy)} onPress={() => reviewWithAgent(group.prs)}>
            {`Review with ${data.defaults.agent || 'agent'}`}
          </Button>
        </Row>
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
          <List label="Single repo">{single.map((pr) => prItem(pr, true))}</List>
        </Stack>
      ) : null}
    </Stack>
  )
}

function byRepo(data: ProjectPrs, prs: PrSummary[]) {
  return (
    <Stack gap="xs">
      {data.repos.map(({ repo, error }) => {
        const mine = prs.filter((pr) => pr.repo === repo.slug)
        const where = `${repo.slug ?? 'no GitHub remote'}${repo.branch ? ` · on ${repo.branch}` : ''}`
        return (
          <Collapsible key={repo.path} title={`${repo.name} (${mine.length})`} description={where} defaultOpen={mine.length > 0}>
            {error ? (
              <Callout tone={repo.slug ? 'danger' : 'neutral'} icon={repo.slug ? 'error' : 'info'}>
                {error}
              </Callout>
            ) : mine.length > 0 ? (
              <List label={repo.name}>{mine.map((pr) => prItem(pr, false))}</List>
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
  const names = items.map((c) => c.repo.name).join(', ')
  const pushes = items.some((c) => c.unpushed !== 0)
  ask({
    title: items.length > 1 ? `Open ${items.length} pull requests?` : `Open a pull request in ${names}?`,
    body:
      `${items.map((c) => `${c.repo.name}: ${c.branch} → ${c.base}`).join('; ')}.` +
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
  const shared = [...byBranch.entries()].filter(([, list]) => list.length > 1)
  return (
    <Stack gap="sm">
      {shared.map(([branch, list]) => (
        <Button key={branch} icon="add" disabled={!!read(busy)} onPress={() => confirmCreate(list, false)}>
          {`Open PRs for ${branch} in ${list.length} repos`}
        </Button>
      ))}
      {items.map((c) => (
        <Card key={c.repo.path} title={c.repo.name} description={`${c.branch} → ${c.base}`}>
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
    </Tabs>
  )
}

export function listView() {
  const data = read(list)
  return (
    <Stack gap="sm">
      {projectPicker()}
      {data && data.project && !data.error && data.repos.some((r) => r.repo.slug) ? summary(data) : null}
      {data && data.project && data.repos.some((r) => r.repo.slug) && read(view) !== 'new' ? filters() : null}
      {noticeBox()}
      {confirmBox()}
      {body(data)}
    </Stack>
  )
}
