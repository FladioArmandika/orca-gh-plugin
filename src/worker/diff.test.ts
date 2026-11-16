import { assert, test } from 'orca/testing'
import { clipPatch, splitDiff } from './diff'

test('splits a diff by file, renames under their new path', () => {
  const files = splitDiff(
    ['diff --git a/a.ts b/a.ts', '+a', 'diff --git a/old name.ts b/new name.ts', 'rename from old name.ts', 'rename to new name.ts', ''].join('\n')
  )
  assert.deepEqual([...files.keys()], ['a.ts', 'new name.ts'])
  assert.equal(files.get('a.ts'), 'diff --git a/a.ts b/a.ts\n+a')
})

test('cuts a long patch at a line end', () => {
  assert.deepEqual(clipPatch('short'), { text: 'short', truncated: false })
  const cut = clipPatch('line one\nline two\nline three', 15)
  assert.deepEqual(cut, { text: 'line one', truncated: true })
})
