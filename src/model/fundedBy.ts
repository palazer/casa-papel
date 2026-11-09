import type { Id } from './ids'

/**
 * Where the cash for an expense item comes from.
 * - 'cash'     the month's income (enters the plug)
 * - 'savings'  taken from the savings account (bypasses the plug)
 * - 'pool:<id>' taken from a pool account (bypasses the plug, draws the pool)
 */
export type FundedBy = 'cash' | 'savings' | `pool:${string}`

export const FUNDED_BY_PATTERN = /^(cash|savings|pool:[0-9A-HJKMNP-TV-Z]{26})$/

export function poolRef(poolId: Id): FundedBy {
  return `pool:${poolId}`
}

export function poolIdOf(f: FundedBy): Id | null {
  return f.startsWith('pool:') ? f.slice(5) : null
}
