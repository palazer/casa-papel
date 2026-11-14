import type { Id } from './ids'

/**
 * Where the cash for an expense item comes from.
 * - 'cash'         the month's income (enters the plug)
 * - 'account:<id>' taken from one account: a savings account, an investment account or an other asset (bypasses the
 *                  plug, lowers that account)
 * - 'pool:<id>'    taken from a virtual account (bypasses the plug, draws the pool)
 * - 'savings'      the choice from before accounts could be named: the first savings account (the engine's
 *                  `primarySavingsId`). Still read and counted as it always was; no longer offered once the household
 *                  has a savings account to name.
 */
export type FundedBy = 'cash' | 'savings' | `pool:${string}` | `account:${string}`

export const FUNDED_BY_PATTERN = /^(cash|savings|(pool|account):[0-9A-HJKMNP-TV-Z]{26})$/

export function poolRef(poolId: Id): FundedBy {
  return `pool:${poolId}`
}

export function accountRef(accountId: Id): FundedBy {
  return `account:${accountId}`
}

/** The account an expense comes out of, when it names one. */
export function accountIdOf(f: FundedBy): Id | null {
  return f.startsWith('account:') ? f.slice(8) : null
}

/** What the row that fills a virtual account is called when the app makes it: "To Travel", beside "To savings". */
export const poolRowName = (poolName: string): string => `To ${poolName}`

export function poolIdOf(f: FundedBy): Id | null {
  return f.startsWith('pool:') ? f.slice(5) : null
}
