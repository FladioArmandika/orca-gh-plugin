import { assert, test } from 'orca/testing'
import { shortNames, taskLink, titleParts } from './title'

test('takes the conventional prefix and the own task suffix off a title', () => {
  assert.deepEqual(titleParts('feat(cards): gift cards at checkout (42)', '42'), { kind: 'feat(cards)', headline: 'Gift cards at checkout' })
  assert.deepEqual(titleParts('fix!: drop the old route (Tasks 987)', '987'), { kind: 'fix!', headline: 'Drop the old route' })
  assert.deepEqual(titleParts('chore: bump deps (12)', '7'), { kind: 'chore', headline: 'Bump deps (12)' }, 'another task id stays')
  assert.deepEqual(titleParts('Release development to main', null), { kind: null, headline: 'Release development to main' })
  assert.deepEqual(titleParts('feat: (42)', '42'), { kind: 'feat', headline: 'feat: (42)' }, 'never an empty headline')
})

test('shortens repo names by the prefix they share', () => {
  assert.deepEqual([...shortNames(['shop-admin', 'shop-be', 'shop-fe']).values()], ['admin', 'be', 'fe'])
  assert.deepEqual([...shortNames(['acme.api', 'acme.web']).values()], ['api', 'web'])
  assert.deepEqual([...shortNames(['api', 'web']).values()], ['api', 'web'])
  assert.deepEqual([...shortNames(['app', 'app-web']).values()], ['app', 'app-web'], 'a name that is all prefix stays whole')
  assert.deepEqual([...shortNames(['shop-be']).values()], ['shop-be'], 'one repo keeps its name')
  assert.deepEqual([...shortNames(['shop-backend', 'shop-batch']).values()], ['backend', 'batch'], 'cut at a separator')
})

test('reads the task link of a description', () => {
  assert.deepEqual(taskLink('**Task:** [Gift cards at checkout (Tasks 42)](https://tasks.example.com/42), under [x](https://e.com)'), {
    title: 'Gift cards at checkout',
    url: 'https://tasks.example.com/42'
  })
  assert.deepEqual(taskLink('Intro\nTask: [Wishlist\n sharing](https://t.example.com/7)'), { title: 'Wishlist sharing', url: 'https://t.example.com/7' })
  assert.deepEqual(taskLink('**Task:** [Tasks 61: Sourcing report](https://t.example.com/61)'), { title: 'Sourcing report', url: 'https://t.example.com/61' })
  assert.equal(taskLink('No task here. See [docs](https://e.com).'), null)
  assert.equal(taskLink(null), null)
})
