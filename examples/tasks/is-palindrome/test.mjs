import test from 'node:test'
import assert from 'node:assert/strict'
import { isPalindrome } from './palindrome.mjs'
test('palindrome true', () => assert.equal(isPalindrome('racecar'), true))
test('palindrome false', () => assert.equal(isPalindrome('hello'), false))
test('single char', () => assert.equal(isPalindrome('a'), true))
test('two chars', () => assert.equal(isPalindrome('ab'), false))
