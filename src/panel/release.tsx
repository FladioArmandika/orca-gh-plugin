// The Release tab: for each repo, how far the develop branch is ahead of the release branch, its
// release pull request, and opening and merging them all, backend first.
import { Badge, Button, Callout, Card, Collapsible, EmptyState, List, read, Row, Skeleton, Stack, Text } from 'orca'
import type { MergeDefaults, ProjectPrs, ReleaseRepo } from '../protocol'
import { byMergeOrder, isReady, mergeSequence, waitsOutside } from '../shared/group'
import { prItem, waitsLine } from './parts'
import { ask, busy, loadRelease, mergeInOrder, openReleases, prName, release, releaseLoading } from './state'

function confirmOpen(repos: ReleaseRepo[], head: string, base: string): void {
  ask({
    title: repos.length > 1 ? `Open ${repos.length} release pull requests?` : `Open the release pull request of ${repos[0].repo.short}?`,
    body:
      `${head} → ${base} in ${repos.map((r) => r.repo.short).join(', ')}. ` +
      'Each is titled with today\'s date and lists the commits it brings.',
    label: 'Open',
    tone: 'accent',
    run: () => openReleases(repos)
  })
}

function confirmMerge(repos: ReleaseRepo[], defaults: MergeDefaults): void {
  const prs = mergeSequence(
    repos.flatMap((r) => (r.pr ? [r.pr] : [])),
    defaults.mergeOrder
  )
  const notReady = prs.filter((pr) => !isReady(pr)).map(prName)
  ask({
    title: `Release ${prs.length} repo${prs.length === 1 ? '' : 's'}?`,
    body:
      `${prs.map(prName).join(' → ')}, in this order, ${defaults.releaseMergeMethod}; the ${defaults.developBranch} branch stays. ` +
      'One at a time; it stops at the first that fails.' +
      (notReady.length ? ` Not ready yet: ${notReady.join(', ')}.` : ''),
    label: `Merge ${prs.length}`,
    tone: notReady.length ? 'warning' : 'success',
    run: () => mergeInOrder('Release', prs, defaults.releaseMergeMethod, false)
  })
}

function repoCard(r: ReleaseRepo, head: string, base: string) {
  const state =
    r.error ?? (r.ahead === null ? '' : r.ahead === 0 ? `Up to date with ${base}` : `${r.ahead} commit${r.ahead === 1 ? '' : 's'} ahead of ${base}`)
  return (
    <Card key={r.repo.path} title={r.repo.short} description={`${head} → ${base}${r.behind ? ` · ${base} has ${r.behind} commit${r.behind === 1 ? '' : 's'} ${head} lacks` : ''}`}>
      <Stack gap="xs">
        <Row gap="xs" align="center" wrap>
          {r.pr ? <Badge tone="accent">Release PR open</Badge> : r.ahead ? <Badge tone="warning">Not released</Badge> : <Badge tone="success">Released</Badge>}
          <Text size="sm" muted tone={r.error ? 'danger' : undefined}>
            {state}
          </Text>
        </Row>
        {r.pr ? <List label={`${r.repo.short} release`}>{[prItem(r.pr, 'repo')]}</List> : null}
        {r.commits.length > 0 ? (
          <Collapsible title={`What it brings (${r.ahead ?? r.commits.length})`}>
            <Stack gap="xs">
              {r.commits.map((c, i) => (
                <Text key={`${i}-${c}`} size="sm">
                  {`• ${c}`}
                </Text>
              ))}
              {r.ahead && r.ahead > r.commits.length ? (
                <Text size="xs" muted>
                  {`… and ${r.ahead - r.commits.length} more`}
                </Text>
              ) : null}
            </Stack>
          </Collapsible>
        ) : null}
      </Stack>
    </Card>
  )
}

export function releaseView(data: ProjectPrs) {
  const status = read(release)
  if (!status) return read(releaseLoading) ? <Skeleton lines={6} label="Comparing branches" /> : null
  if (status.error && status.repos.length === 0) return <Callout tone="danger" icon="error">{status.error}</Callout>
  const { head, base } = status
  const repos = byMergeOrder(
    status.repos.map((r) => ({ ...r, repoName: r.repo.name })),
    data.defaults.mergeOrder
  )
  if (repos.length === 0) return <EmptyState icon="rocket" title="Nothing to release" description="No GitHub repos here." />
  const toOpen = repos.filter((r) => !r.pr && (r.ahead ?? 0) > 0)
  const open = repos.flatMap((r) => (r.pr && !r.pr.draft ? [r.pr] : []))
  const blocked = waitsOutside(open)
  const running = !!read(busy)
  return (
    <Stack gap="sm">
      <Row gap="xs" wrap align="center">
        <Text size="sm" muted>
          {`${head} → ${base}, merged with a ${data.defaults.releaseMergeMethod === 'merge' ? 'merge commit' : data.defaults.releaseMergeMethod}, backend first.`}
        </Text>
      </Row>
      <Row gap="xs" wrap>
        <Button icon="add" variant="outline" disabled={running || toOpen.length === 0} onPress={() => confirmOpen(toOpen, head, base)}>
          {toOpen.length ? `Open release PRs (${toOpen.length})` : 'No release PR to open'}
        </Button>
        <Button
          icon="rocket"
          tone="success"
          variant="outline"
          disabled={running || open.length === 0 || blocked.length > 0}
          tooltip={blocked.length ? 'A release PR waits for one outside the release' : undefined}
          onPress={() => confirmMerge(repos.filter((r) => r.pr && !r.pr.draft), data.defaults)}
        >
          {open.length ? `Merge releases in order (${open.length})` : 'No release PR to merge'}
        </Button>
        <Button icon="refresh" variant="ghost" disabled={read(releaseLoading)} onPress={() => loadRelease()}>
          Compare again
        </Button>
      </Row>
      {blocked.length ? (
        <Text size="sm" tone="warning">
          {`${waitsLine(blocked)}, still open. Merge that first.`}
        </Text>
      ) : null}
      {repos.map((r) => repoCard(r, head, base))}
    </Stack>
  )
}
