import { decimalSeparator, parseAmount } from '@/app/format'
import { ENTITY_TEMPLATES, HOUSEHOLD_TEMPLATES, type AccountType, type EntityKind, type Household, type Section } from '@/model'
import type { SetupInput } from '@/store'

/** What the setup wizard collects before anything is written. */
export interface Draft {
  name: string
  currency: string
  locale: string
  startMonth: string
  closingRule: Household['closingRule']
  moneyMode: Household['moneyMode']
  pocketTotal: string
  adults: Array<{ name: string }>
  dependents: Array<{ kind: Exclude<EntityKind, 'adult'>; name: string; paidByIndex: number | null }>
  /** `currency` null = the household currency, so it follows a later change of the household's. */
  accounts: Array<{ name: string; type: AccountType; openingBalance: string; currency: string | null }>
  householdTemplates: Set<string>
  /** keyed by the position in the draft: adults first, then dependents (see `keptEntities`) */
  entityTemplates: Record<number, Set<string>>
  /** subject 0 = household, i + 1 = kept entity i */
  customRows: Array<{ subject: number; name: string; section: Section }>
}

export interface Errors { pocketTotal?: string; accounts: Record<number, string> }

export const recommended = (kind: EntityKind | 'household') =>
  new Set((kind === 'household' ? HOUSEHOLD_TEMPLATES : ENTITY_TEMPLATES[kind]).filter((t) => t.recommended).map((t) => t.key))

export function validate(d: Draft): Errors {
  const errors: Errors = { accounts: {} }
  const hint = `Digits only, "${decimalSeparator(d.locale)}" for decimals, like ${new Intl.NumberFormat(d.locale).format(1234.5)}.`
  if (d.pocketTotal.trim() && parseAmount(d.pocketTotal, d.currency, d.locale) == null) errors.pocketTotal = `Not a number. ${hint}`
  d.accounts.forEach((a, i) => {
    if (a.openingBalance.trim() && parseAmount(a.openingBalance, a.currency ?? d.currency, d.locale) == null) errors.accounts[i] = `Not a number. ${hint}`
  })
  return errors
}

/**
 * The people and things that will be created, in their created order: blank names are dropped, and a household with no
 * named adult gets "Me". `at` is the position in the draft (adults first, then dependents) that `entityTemplates` is keyed by.
 */
export function keptEntities(d: Draft): Array<{ at: number; kind: EntityKind; name: string }> {
  const adults = d.adults.map((a, i) => ({ at: i, kind: 'adult' as EntityKind, name: a.name.trim() })).filter((a) => a.name)
  const dependents = d.dependents.map((x, j) => ({ at: d.adults.length + j, kind: x.kind as EntityKind, name: x.name.trim() })).filter((x) => x.name)
  return [...(adults.length ? adults : [{ at: 0, kind: 'adult' as EntityKind, name: 'Me' }]), ...dependents]
}

/** The draft as the store takes it: kept entities only, with templates and "paid by" re-indexed onto the kept list. */
export function toSetupInput(d: Draft): SetupInput {
  const kept = keptEntities(d)
  const keptAdultAts = kept.filter((e) => e.kind === 'adult').map((e) => e.at)
  const pocket = d.pocketTotal.trim() ? parseAmount(d.pocketTotal, d.currency, d.locale) ?? 0 : 0
  return {
    household: { name: d.name.trim() || 'Our household', baseCurrency: d.currency, locale: d.locale, startMonth: d.startMonth, closingRule: d.closingRule, moneyMode: d.moneyMode, pocketTotal: pocket },
    adults: kept.filter((e) => e.kind === 'adult').map((e) => ({ name: e.name })),
    dependents: kept.filter((e) => e.kind !== 'adult').map((e) => {
      const x = d.dependents[e.at - d.adults.length]
      return { kind: x.kind, name: e.name, paidByIndex: x.paidByIndex == null ? null : Math.max(0, keptAdultAts.indexOf(x.paidByIndex)) }
    }),
    accounts: d.accounts.filter((a) => a.name.trim()).map((a) => ({
      name: a.name.trim(), type: a.type, currency: a.currency ?? d.currency,
      openingBalance: a.openingBalance.trim() ? parseAmount(a.openingBalance, a.currency ?? d.currency, d.locale) ?? 0 : 0,
    })),
    householdTemplates: [...d.householdTemplates],
    entityTemplates: Object.fromEntries(kept.map((e, k) => [k, [...(d.entityTemplates[e.at] ?? recommended(e.kind))]])),
  }
}
