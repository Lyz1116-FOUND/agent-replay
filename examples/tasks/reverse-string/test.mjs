import test from 'node:test'
import assert from 'node:assert/strict'
import { reverse } from './reverse.mjs'
test('reverse abc', () => assert.equal(reverse('abc'), 'cba'))
test('reverse empty', () => assert.equal(reverse(''), ''))
test('reverse sentence', () => assert.equal(reverse('hello world'), 'dlrow olleh'))
