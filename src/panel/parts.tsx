// Small pieces every view uses: a pull request row, the notice line and the confirm box.
import { Badge, Button, Callout, ListItem, read, RelativeTime, Row, set, Text } from 'orca'
import type { PrSummary } from '../protocol'
import { badges } from '../shared/look'
import { busy, confirmPending, notice, openPr, pending } from './state'

export function badgeRow(pr: PrSummary) {
  const looks = badges(pr)
  return (
    <Row gap="xs" wrap align="center">
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

export function prItem(pr: PrSummary, showRepo: boolean) {
  const where = `${pr.head} → ${pr.base}`
  return (
    <ListItem
      key={pr.key}
      title={`#${pr.number} ${pr.title}`}
      description={`${showRepo ? `${pr.repoName} · ` : ''}${where} · ${pr.author}`}
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
