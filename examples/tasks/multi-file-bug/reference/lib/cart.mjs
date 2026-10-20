import { lineTotal } from './pricing.mjs'

export function cartTotal(items) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0)
}
