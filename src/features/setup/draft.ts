import { decimalSeparator, parseAmount } from '@/app/format'
import { ENTITY_TEMPLATES, HOUSEHOLD_TEMPLATES, type AccountType, type EntityKind, type Household, type RowTemplate, type Section } from '@/model'
import type { SetupInput, TemplateChoice } from '@/store'

export interface DraftAccount {
  name: string
  type: AccountType
  openingBalance: string
  /** null = the household currency, so it follows a later change of the household's. */
  currency: string | null
  /** Whose it is: a position in the draft's entity list (adults first, then dependents); null = the household's. */
  ownerAt: number | null
}

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
  accounts: DraftAccount[]
  householdTemplates: Set<string>
  /** keyed by the position in the draft: adults first, then dependents (see `keptEntities`) */
  entityTemplates: Record<number, Set<string>>
  /** a "To <account>" deposit row is on unless the account's position is here */
  depositsOff: Set<number>
  /** first monthly amounts as typed, by row key (`rowKey`, `depositKey`) */
  amounts: Record<string, string>
  /** the account a template with `account:` points at, by row key; absent = `defaultLink` */
  links: Record<string, number>
  /** subject 0 = household, i + 1 = kept entity i */
  customRows: Array<{ subject: number; name: string; section: Section; amount: string }>
}

export interface Errors { pocketTotal?: string; accounts: Record<number, string>; amounts: Record<string, string> }

export const recommended = (kind: EntityKind | 'household') =>
  new Set((kind === 'household' ? HOUSEHOLD_TEMPLATES : ENTITY_TEMPLATES[kind]).filter((t) => t.recommended).map((t) => t.key))

/** The key of a template row's amount or link: the subject's draft position ('h' for the household) and the template. */
export const rowKey = (subjectAt: number | 'h', templateKey: string): string => `${subjectAt}:${templateKey}`
export const depositKey = (accountAt: number): string => `dep:${accountAt}`
export const customKey = (index: number): string => `custom:${index}`

/**
 * The templates offered to a subject. The household's "To investments" is replaced by one deposit row per investment
 * account (`depositTargets`); so is "To savings" when the user decides the savings amount; pocket rows need the pooled mode.
 */
export function templatesFor(d: Draft, kind: EntityKind | null): RowTemplate[] {
  if (kind) return ENTITY_TEMPLATES[kind].filter((t) => !(t.pocket && d.moneyMode !== 'pooled'))
  return HOUSEHOLD_TEMPLATES.filter((t) => t.key !== 'h.toInvestments' && !(t.key === 'h.toSavings' && d.closingRule === 'leftover-plug'))
}

/** Named accounts with their draft positions. */
export const namedAccounts = (d: Draft, type?: AccountType) =>
  d.accounts.map((account, at) => ({ account, at })).filter(({ account }) => account.name.trim() && (!type || account.type === type))

/** The accounts that get a "To <name>" deposit row: investments always, savings only when the user decides the savings amount. */
export const depositTargets = (d: Draft) =>
  namedAccounts(d).filter(({ account }) => account.type === 'investment' || (account.type === 'savings' && d.closingRule === 'leftover-plug'))

/** Automatic rows take no amount: the savings plug and pocket money. */
export const isAutomatic = (d: Draft, t: RowTemplate): boolean => !!t.pocket || (t.kind === 'to-savings' && d.closingRule === 'savings-plug')

/** The account a subject's row points at by default: the subject's own account of that type, else the first one. */
export function defaultLink(d: Draft, subjectAt: number | 'h', type: AccountType): number | null {
  const candidates = namedAccounts(d, type)
  return (candidates.find(({ account }) => account.ownerAt === subjectAt) ?? candidates[0])?.at ?? null
}

/** The account a template row points at: the chosen one if it still exists and fits, else the default. */
export function linkFor(d: Draft, subjectAt: number | 'h', t: RowTemplate): number | null {
  if (!t.account) return null
  const chosen = d.links[rowKey(subjectAt, t.key)]
  if (chosen != null && d.accounts[chosen]?.type === t.account && d.accounts[chosen].name.trim()) return chosen
  return defaultLink(d, subjectAt, t.account)
}

const parse = (d: Draft, v: string | undefined): number | null => (v?.trim() ? parseAmount(v, d.currency, d.locale) ?? null : null)

export function validate(d: Draft): Errors {
  const errors: Errors = { accounts: {}, amounts: {} }
  const hint = `Digits only, "${decimalSeparator(d.locale)}" for decimals, like ${new Intl.NumberFormat(d.locale).format(1234.5)}.`
  if (d.pocketTotal.trim() && parseAmount(d.pocketTotal, d.currency, d.locale) == null) errors.pocketTotal = `Not a number. ${hint}`
  d.accounts.forEach((a, i) => {
    if (a.openingBalance.trim() && parseAmount(a.openingBalance, a.currency ?? d.currency, d.locale) == null) errors.accounts[i] = `Not a number. ${hint}`
  })
  for (const [key, v] of Object.entries(d.amounts)) if (v.trim() && parseAmount(v, d.currency, d.locale) == null) errors.amounts[key] = `Not a number. ${hint}`
  d.customRows.forEach((r, i) => {
    if (r.amount.trim() && parseAmount(r.amount, d.currency, d.locale) == null) errors.amounts[customKey(i)] = `Not a number. ${hint}`
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

/** The draft as the store takes it: kept entities and named accounts only, templates, links, amounts and deposits re-indexed onto them. */
export function toSetupInput(d: Draft): SetupInput {
  const kept = keptEntities(d)
  const keptAdultAts = kept.filter((e) => e.kind === 'adult').map((e) => e.at)
  const accounts = namedAccounts(d)
  const entityIndexOf = (at: number | null) => (at == null ? null : kept.findIndex((e) => e.at === at) < 0 ? null : kept.findIndex((e) => e.at === at))
  const accountIndexOf = (at: number | null) => (at == null ? null : accounts.findIndex((x) => x.at === at) < 0 ? null : accounts.findIndex((x) => x.at === at))
  const choices = (subjectAt: number | 'h', kind: EntityKind | null, keys: Set<string>): TemplateChoice[] =>
    templatesFor(d, kind).filter((t) => keys.has(t.key)).map((t) => ({
      key: t.key,
      accountIndex: t.account ? accountIndexOf(linkFor(d, subjectAt, t)) : undefined,
      amount: isAutomatic(d, t) ? null : parse(d, d.amounts[rowKey(subjectAt, t.key)]),
    }))
  const pocket = d.pocketTotal.trim() ? parseAmount(d.pocketTotal, d.currency, d.locale) ?? 0 : 0
  return {
    household: { name: d.name.trim() || 'Our household', baseCurrency: d.currency, locale: d.locale, startMonth: d.startMonth, closingRule: d.closingRule, moneyMode: d.moneyMode, pocketTotal: pocket },
    adults: kept.filter((e) => e.kind === 'adult').map((e) => ({ name: e.name })),
    dependents: kept.filter((e) => e.kind !== 'adult').map((e) => {
      const x = d.dependents[e.at - d.adults.length]
      return { kind: x.kind, name: e.name, paidByIndex: x.paidByIndex == null ? null : Math.max(0, keptAdultAts.indexOf(x.paidByIndex)) }
    }),
    accounts: accounts.map(({ account: a }) => ({
      name: a.name.trim(), type: a.type, currency: a.currency ?? d.currency,
      openingBalance: a.openingBalance.trim() ? parseAmount(a.openingBalance, a.currency ?? d.currency, d.locale) ?? 0 : 0,
      ownerIndex: entityIndexOf(a.ownerAt),
    })),
    householdTemplates: choices('h', null, d.householdTemplates),
    entityTemplates: Object.fromEntries(kept.map((e, k) => [k, choices(e.at, e.kind, d.entityTemplates[e.at] ?? recommended(e.kind))])),
    deposits: depositTargets(d).filter(({ at }) => !d.depositsOff.has(at)).map(({ at }) => ({ accountIndex: accountIndexOf(at)!, amount: parse(d, d.amounts[depositKey(at)]) })),
    customRows: d.customRows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), section: r.section, entityIndex: r.subject === 0 ? null : r.subject - 1, amount: parse(d, r.amount) })),
  }
}
