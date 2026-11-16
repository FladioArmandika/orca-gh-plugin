import { assert, test } from 'orca/testing'
import { parseDependencies, resolveDependency } from './deps'

test('reads merge dependencies the way descriptions write them', () => {
  assert.deepEqual(parseDependencies('**Merge after be#12** (branched from it)'), [{ repo: 'be', number: 12 }])
  assert.deepEqual(parseDependencies('Pairs with: shop-be `feat/1-x` (backend first, after be#12)'), [
    { repo: 'be', number: 12 }
  ])
  assert.deepEqual(parseDependencies('Depends on #12, then requires acme/shop-be#3.'), [
    { repo: null, number: 12 },
    { repo: 'acme/shop-be', number: 3 }
  ])
  assert.deepEqual(parseDependencies('Merge after https://github.com/acme/shop-fe/pull/9 lands'), [{ repo: 'acme/shop-fe', number: 9 }])
  assert.deepEqual(parseDependencies('Fixes be#10. Pairs with: acme/shop-be#14 (merge that first).'), [], 'fixes and pairs-with are not waits')
  assert.deepEqual(parseDependencies(null), [])
})

test('resolves short repo names among the project repos only', () => {
  const repos = [
    { slug: 'acme/shop-be', name: 'shop-be' },
    { slug: 'acme/shop-fe', name: 'shop-fe' },
    { slug: 'acme/shop-fe-legacy', name: 'shop-fe-legacy' }
  ]
  const from = repos[1]
  assert.equal(resolveDependency({ repo: 'be', number: 12 }, from, repos), 'acme/shop-be#12')
  assert.equal(resolveDependency({ repo: null, number: 5 }, from, repos), 'acme/shop-fe#5')
  assert.equal(resolveDependency({ repo: 'shop-fe-legacy', number: 1 }, from, repos), 'acme/shop-fe-legacy#1')
  assert.equal(resolveDependency({ repo: 'ACME/shop-be', number: 2 }, from, repos), 'acme/shop-be#2')
  assert.equal(resolveDependency({ repo: 'other/repo', number: 2 }, from, repos), null)
  assert.equal(resolveDependency({ repo: 'api', number: 2 }, from, repos), null)
})
