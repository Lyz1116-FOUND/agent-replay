import test from 'node:test'
import assert from 'node:assert/strict'
import { capitalize } from './capitalize.mjs'
test('capitalize hello', () => assert.equal(capitalize('hello'), 'Hello'))
test('capitalize empty', () => assert.equal(capitalize(''), ''))
test('capitalize java', () => assert.equal(capitalize('java'), 'Java'))
