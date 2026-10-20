import test from 'node:test'
import assert from 'node:assert/strict'
import { cartTotal } from './lib/cart.mjs'
import { applyDiscount } from './lib/discount.mjs'
import { lineTotal } from './lib/pricing.mjs'

test('lineTotal multiplies price by quantity', () => {
  assert.equal(lineTotal({ price: 10, qty: 2 }), 20)
})

test('cartTotal respects quantity', () => {
  assert.equal(cartTotal([{ price: 10, qty: 2 }]), 20)
})

test('cartTotal sums several lines', () => {
  assert.equal(
    cartTotal([
      { price: 10, qty: 2 },
      { price: 5, qty: 3 },
    ]),
    35,
  )
})

test('applyDiscount treats percent as a percentage', () => {
  assert.equal(applyDiscount(200, 10), 180)
  assert.equal(applyDiscount(50, 0), 50)
})
