import test from 'node:test'
import assert from 'node:assert/strict'
import { slugify, uniqueSlug } from './index.mjs'

test('slugify lowercases and joins words with dashes', () => {
  assert.equal(slugify('Hello World'), 'hello-world')
})

test('slugify strips accents and punctuation', () => {
  assert.equal(slugify('  Héllo, World!  '), 'hello-world')
})

test('slugify collapses repeated separators', () => {
  assert.equal(slugify('a --  b'), 'a-b')
})

test('uniqueSlug appends the next free suffix', () => {
  assert.equal(uniqueSlug('a', []), 'a')
  assert.equal(uniqueSlug('a', ['a']), 'a-2')
  assert.equal(uniqueSlug('a', ['a', 'a-2']), 'a-3')
})
