import { assert, test } from 'orca/testing'
import { branchOk, releaseBody, releaseTitle } from './release'

test('names and describes a release', () => {
  assert.equal(releaseTitle('development', 'main', new Date('2026-11-17T08:00:00Z')), 'Release development to main (2026-11-17)')
  assert.equal(releaseBody('development', 'main', ['feat: a', 'fix: b'], 2), 'Merges development into main.\n\n- feat: a\n- fix: b')
  assert.match(releaseBody('development', 'main', ['feat: a'], 40), /- … and 39 more$/)
})

test('accepts only plain branch names', () => {
  assert.equal(branchOk('feat/42-gift-cards'), true)
  assert.equal(branchOk('--upload-pack=x'), false)
  assert.equal(branchOk('a..b'), false)
  assert.equal(branchOk('a b'), false)
  assert.equal(branchOk(undefined), false)
})
