import test from 'node:test'
import assert from 'node:assert/strict'
import { max } from './max.mjs'
test('max positive', () => assert.equal(max(3, 5), 5))
test('max negative', () => assert.equal(max(-5, -1), -1))
test('max equal', () => assert.equal(max(7, 7), 7))
