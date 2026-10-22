import test from 'node:test'
import assert from 'node:assert/strict'
import { fib } from './fib.mjs'
test('fib 0', () => assert.equal(fib(0), 0))
test('fib 1', () => assert.equal(fib(1), 1))
test('fib 2', () => assert.equal(fib(2), 1))
test('fib 6', () => assert.equal(fib(6), 8))
