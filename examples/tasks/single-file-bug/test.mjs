import test from 'node:test'
import assert from 'node:assert/strict'
import { bump } from './calc.mjs'

test('bump 1', () => assert.equal(bump(1), 2))
test('bump 2', () => assert.equal(bump(2), 3))
test('bump 0', () => assert.equal(bump(0), 1))
