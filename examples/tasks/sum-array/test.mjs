import test from 'node:test'
import assert from 'node:assert/strict'
import { sum } from './sum.mjs'
test('sum positive', () => assert.equal(sum([1, 2, 3]), 6))
test('sum empty', () => assert.equal(sum([]), 0))
test('sum mixed', () => assert.equal(sum([-1, 1, 0]), 0))
