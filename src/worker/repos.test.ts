import { assert, test } from 'orca/testing'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findRepoPaths, isGitHubHost, parseRemote } from './repos'

test('parses GitHub remotes, SSH aliases included', () => {
  assert.deepEqual(parseRemote('git@github.com:acme/shop-be.git'), { host: 'github.com', slug: 'acme/shop-be' })
  assert.deepEqual(parseRemote('git@github.com-work:acme/shop-admin.git'), {
    host: 'github.com-work',
    slug: 'acme/shop-admin'
  })
  assert.deepEqual(parseRemote('https://github.com/acme/shop-fe'), { host: 'github.com', slug: 'acme/shop-fe' })
  assert.deepEqual(parseRemote('ssh://git@github.com:22/acme/shop.git/'), { host: 'github.com', slug: 'acme/shop' })
  assert.equal(parseRemote('/local/bare/repo.git'), null)
  assert.equal(parseRemote('https://github.com/acme'), null)
})

test('treats github.com aliases as github.com, other hosts not', () => {
  assert.equal(isGitHubHost('github.com'), true)
  assert.equal(isGitHubHost('github.com-personal'), true)
  assert.equal(isGitHubHost('gitlab.com'), false)
  assert.equal(isGitHubHost('github.example.com'), false)
})

test('finds repos below a folder, not inside dependencies or other repos', async () => {
  const root = await mkdtemp(join(tmpdir(), 'project-prs-'))
  try {
    for (const dir of ['shop-be/.git', 'shop-fe/.git', 'shop-fe/packages/inner/.git', 'node_modules/dep/.git', 'apps/admin/.git', '.hidden/x/.git']) {
      await mkdir(join(root, dir), { recursive: true })
    }
    const found = await findRepoPaths(root, 2)
    assert.deepEqual(found, [join(root, 'apps/admin'), join(root, 'shop-be'), join(root, 'shop-fe')])
    assert.deepEqual(await findRepoPaths(join(root, 'shop-be'), 2), [join(root, 'shop-be')])
    assert.deepEqual(await findRepoPaths(root, 1), [join(root, 'shop-be'), join(root, 'shop-fe')])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
