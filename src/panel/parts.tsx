// Small pieces every view uses: a pull request row, the notice line and the confirm box.
import { Badge, Button, Callout, ListItem, read, RelativeTime, Row, set, Text } from 'orca'
import type { PrSummary } from '../protocol'
import { badges } from '../shared/look'
import { allPrs, busy, confirmPending, notice, openPr, pending, prName } from './state'

/** `be#12` for a pull request key, from the list when it is there. */
export function prLabel(key: string): string {
  const pr = allPrs().find((p) => p.key === key)
  if (pr) return prName(pr)
  const [slug, number] = key.split('#')
  return `${slug.split('/')[1] ?? slug}#${number}`
}

/** "be#13 waits for be#12" for each pair. */
export function waitsLine(pairs: readonly [string, string][]): string {
  return pairs.map(([waiting, waited]) => `${prLabel(waiting)} waits for ${prLabel(waited)}`).join('; ')
}

export function badgeRow(pr: PrSummary) {
  const looks = badges(pr)
  return (
    <Row gap="xs" wrap align="center">
      {pr.waitsFor.map((key) => (
        <Badge key={`waits-${key}`} tone="warning">
          {`Waits for ${prLabel(key)}`}
        </Badge>
      ))}
      {looks.map((look) => (
        <Badge key={look.text} tone={look.tone}>
          {look.text}
        </Badge>
      ))}
      <Text muted size="xs">
        <RelativeTime at={pr.updatedAt} format="short" muted />
      </Text>
    </Row>
  )
}

/** A pull request row. In a task card the card already names the branch, so the row leaves it
 *  out; in a repo's list the repo is already named. */
export function prItem(pr: PrSummary, place: 'card' | 'repo' | 'list') {
  const parts = [
    place === 'repo' ? `#${pr.number}` : prName(pr),
    pr.kind,
    place === 'card' ? null : `${pr.head} → ${pr.base}`,
    pr.author
  ].filter(Boolean)
  return (
    <ListItem
      key={pr.key}
      title={pr.headline}
      description={parts.join(' · ')}
      icon={pr.draft ? 'edit' : 'branch'}
      onPress={() => openPr(pr.key)}
    >
      {badgeRow(pr)}
    </ListItem>
  )
}

export function noticeBox() {
  const value = read(notice)
  const running = read(busy)
  if (running) return <Callout tone="neutral" icon="refresh">{running}</Callout>
  if (!value) return null
  return (
    <Callout tone={value.tone} icon={value.tone === 'success' ? 'check' : value.tone === 'danger' ? 'error' : 'info'}>
      <Row justify="between" align="start" gap="sm">
        <Text size="sm">{value.text}</Text>
        <Button size="xs" variant="ghost" onPress={() => set(notice, null)}>
          Dismiss
        </Button>
      </Row>
    </Callout>
  )
}

export function confirmBox() {
  const value = read(pending)
  if (!value) return null
  return (
    <Callout tone={value.tone} title={value.title} icon="warning">
      <Text size="sm">{value.body}</Text>
      <Row gap="xs">
        <Button size="sm" tone={value.tone} onPress={confirmPending}>
          {value.label}
        </Button>
        <Button size="sm" variant="ghost" onPress={() => set(pending, null)}>
          Cancel
        </Button>
      </Row>
    </Callout>
  )
}
