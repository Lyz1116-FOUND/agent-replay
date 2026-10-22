import test from 'node:test'
import assert from 'node:assert/strict'
import { dedupe } from './dedupe.mjs'
test('dedupe numbers', () => assert.deepEqual(dedupe([1, 1, 2]), [1, 2]))
test('dedupe empty', () => assert.deepEqual(dedupe([]), []))
test('dedupe strings', () => assert.deepEqual(dedupe(['a', 'b', 'a']), ['a', 'b']))
