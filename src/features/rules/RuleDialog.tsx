import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InfoTip, TipLabel } from '@/components/InfoTip'
import { MonthField } from '@/components/MonthField'
import { Segmented } from '@/components/Segmented'
import { amountToInput, formatAmount, formatMonth, formatShare, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { cellKey, computeEngine, sortRows } from '@/engine'
import { addMonths, compareMonths, parseMonth, resolveRules, type Household, type MonthKey, type Row, type Tables } from '@/model'
import { previewRule, ruleRowOf, setRule, type RuleChoice, type RuleTarget } from '@/store'
import { useSave } from '@/features/grid/RowDialogs'

interface Props {
  tables: Tables
  household: Household
  /** The row, or the account or pool account whose transfer gets the rule. */
  target: RuleTarget
  /** The month the dialog was opened from: the rule counts from there unless another month is picked. */
  month: MonthKey
  onClose: () => void
}

type Kind = RuleChoice['kind']

const KINDS: Array<{ value: Kind; label: string; text: string }> = [
  { value: 'fixed', label: 'A fixed amount', text: 'The same amount every month until you change it.' },
  { value: 'share-of-income', label: 'A percentage of income', text: 'A share of the month\'s take-home income: what comes in, minus what is deducted from it. Money taken out of investments does not count.' },
  { value: 'share-of-rest', label: 'A percentage of what is left', text: 'A share of what the month has left after spending, fixed amounts, percentages of income and the cash kept in the account. Nothing in a month that overruns.' },
  { value: 'rest', label: 'The rest', text: 'Everything that is left after all of that. A month that overruns takes the difference back from this account. One account can take the rest.' },
]

/**
 * What the fields say, as text (`fixed:30000`, `share-of-income:0.1`, `rest`): a plain value the preview can depend
 * on. Null while the field is empty or cannot be read.
 */
function choiceKeyOf(kind: Kind, amount: number | null, share: number | null): string | null {
  if (kind === 'rest') return 'rest'
  if (kind === 'fixed') return amount != null ? `fixed:${amount}` : null
  return share != null && Number.isFinite(share) ? `${kind}:${share}` : null
}

function choiceOf(key: string): RuleChoice {
  const [kind, value] = key.split(':')
  if (kind === 'fixed') return { kind, amount: Number(value) }
  if (kind === 'share-of-income' || kind === 'share-of-rest') return { kind, share: Number(value) }
  return { kind: 'rest' }
}

/** A stored fraction as the field shows it: to a tenth of a percent. */
const shareInput = (share: number): string => String(Math.round(share * 1000) / 10)

/**
 * How much goes to an account each month (DESIGN.md §8): a fixed amount, a percentage of income, a percentage of what
 * is left, or the rest. The rule counts from a month on; the dialog runs it on a copy first, so the figure it shows
 * and every refusal are the ones saving would give.
 */
export function RuleDialog({ tables, household, target: given, month, onClose }: Props) {
  const store = useStore()
  // one dialog, one target: held so a parent that builds the object on every render does not rerun the engine
  const [target] = useState(given)
  const { locale, baseCurrency: base } = household
  const found = useMemo((): { row: Row | null; error?: string } => {
    try {
      return { row: ruleRowOf(tables, target) }
    } catch (e) {
      return { row: null, error: e instanceof Error ? e.message : 'That cannot have a rule.' }
    }
  }, [tables, target])
  const row = found.row
  const pool = 'poolId' in target ? tables.pools.find((p) => p.id === target.poolId) : row ? tables.pools.find((p) => !p.deletedAt && p.allocationRowId === row.id) : undefined
  const account = 'accountId' in target ? tables.accounts.find((a) => a.id === target.accountId) : row?.accountId ? tables.accounts.find((a) => a.id === row.accountId) : undefined
  const name = pool?.name ?? account?.name ?? row?.name ?? 'this account'
  const canRest = row ? row.kind === 'to-savings' : !pool && account?.type === 'savings'
  const ccy = row?.currency ?? base

  /** The rule the row has now, who takes the rest, and what the other accounts take of what is left. */
  const now = useMemo(() => {
    const rules = resolveRules(sortRows(tables.rows.filter((r) => !r.deletedAt), tables.categories), household.closingRule)
    const state = row ? rules.byRow.get(row.id) : undefined
    const kind: Kind = state?.kind === 'share-of-income' || state?.kind === 'share-of-rest' || state?.kind === 'rest' ? state.kind : 'fixed'
    let othersOfRest = 0
    for (const [id, s] of rules.byRow) if (s.kind === 'share-of-rest' && id !== row?.id) othersOfRest += s.share
    return { kind, share: state && state.share > 0 ? state.share : null, restRowName: tables.rows.find((r) => r.id === rules.restRowId)?.name ?? null, hasRest: !!row && rules.restRowId === row.id, othersOfRest }
  }, [tables, household.closingRule, row])
  const { kind: current, hasRest, othersOfRest, restRowName } = now

  // a closed month cannot start a rule: begin after the last closed month
  const lastClosed = tables.monthStates.filter((s) => s.closed).map((s) => s.month).sort().at(-1)
  const earliest = compareMonths(month, household.startMonth) < 0 ? household.startMonth : month
  const [from, setFrom] = useState<MonthKey>(lastClosed && compareMonths(lastClosed, earliest) >= 0 ? addMonths(lastClosed, 1) : earliest)
  const [kind, setKind] = useState<Kind>(current)
  /** What the row shows in the month the dialog was opened from: the amount a fixed rule starts from. */
  const shown = useMemo(() => (row ? computeEngine({ tables, months: [month] }).cells[cellKey(row.id, month)] : undefined), [tables, row, month])
  const [amountText, setAmountText] = useState(current === 'fixed' && shown && shown.value > 0 ? amountToInput(shown.value, shown.currency, locale) : '')
  const seededShare = now.share != null ? shareInput(now.share) : ''
  const [shareText, setShareText] = useState(seededShare)
  const { error, busy, save } = useSave(onClose)

  const share = kind === 'share-of-income' || kind === 'share-of-rest'
  // an untouched field keeps the stored fraction exactly
  const typedShare = shareText.trim() === '' ? null : shareText === seededShare && now.share != null ? now.share : Number(shareText.replace(',', '.')) / 100
  const typedAmount = amountText.trim() === '' ? null : parseAmount(amountText, ccy, locale)
  const choiceKey = choiceKeyOf(kind, typedAmount, typedShare)
  const typedSomething = kind === 'fixed' ? amountText.trim() !== '' : share && shareText.trim() !== ''
  const fieldError = !choiceKey && typedSomething ? 'That is not a number I can read.' : null
  /** The rule tried on a copy: what the start month would show, or why it cannot be saved. */
  const preview = useMemo(() => {
    if (!choiceKey || found.error) return null
    try {
      const { row: r, engine } = previewRule(tables, target, choiceOf(choiceKey), from, [from])
      const t = engine.totals[from]
      return { amount: engine.cells[cellKey(r.id, from)]?.valueBase ?? 0, takeHome: t.takeHome, left: t.leftForShares, rest: t.rest, leftover: t.leftover }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'That rule cannot be saved.' }
    }
  }, [tables, target, from, choiceKey, found.error])
  const problem = fieldError ?? (preview && 'error' in preview ? preview.error : null)
  const figures = preview && !('error' in preview) ? preview : null
  const monthName = formatMonth(from, locale, 'long')
  const money = (v: number) => formatAmount(v, base, locale)
  const startYear = parseMonth(household.startMonth).year

  function submit() {
    if (!choiceKey || problem) return
    const chosen = choiceOf(choiceKey)
    void save(async () => { await setRule(store, target, chosen, from) })
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>How much goes to {name}?</DialogTitle>
          <DialogDescription>
            {found.error ?? (row ? <>Row &quot;{row.name}&quot;. Each month the app works the amount out from the rule you pick.</> : <>Nothing moves money to {name} yet. Saving adds the row &quot;{pool ? `${pool.name} pool` : `To ${name}`}&quot; under Transfers.</>)}
          </DialogDescription>
        </DialogHeader>
        {!found.error && (
          <div className="space-y-4">
            <fieldset className="space-y-1.5">
              <legend className="flex items-center gap-1 text-sm font-medium">Rule <InfoTip help="row.rule" /></legend>
              <Segmented label="Rule" value={kind} onChange={(v) => setKind(v as Kind)} options={KINDS.filter((k) => k.value !== 'rest' || canRest).map(({ value, label }) => ({ value, label }))} />
              <p className="text-xs text-muted-foreground">{KINDS.find((k) => k.value === kind)?.text}</p>
              {!canRest && <p className="text-xs text-muted-foreground">Only a savings account can take the rest.</p>}
            </fieldset>

            {kind === 'fixed' && (
              <div className="space-y-1.5">
                <Label htmlFor="rule-amount">Amount per month in {ccy}</Label>
                <Input id="rule-amount" className="w-40" autoFocus inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="e.g. 300" />
              </div>
            )}
            {share && (
              <div className="space-y-1.5">
                <Label htmlFor="rule-share">{kind === 'share-of-income' ? 'Percentage of income' : 'Percentage of what is left'}</Label>
                <Input id="rule-share" className="w-28" autoFocus inputMode="decimal" value={shareText} onChange={(e) => setShareText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="e.g. 10" />
                {kind === 'share-of-rest' && othersOfRest > 0 && <p className="text-xs text-muted-foreground">Other accounts already take {formatShare(othersOfRest, locale)} of what is left.</p>}
              </div>
            )}
            {kind === 'rest' && !hasRest && restRowName && (
              <p className="text-xs text-muted-foreground">&quot;{restRowName}&quot; takes the rest now. From {monthName} on it comes here instead, and &quot;{restRowName}&quot; gets nothing more until you give it a rule of its own.</p>
            )}
            {kind !== 'rest' && hasRest && (
              <p className="text-xs text-muted-foreground">{name} takes the rest now. With this rule no account does: from {monthName} on the rest stays in the main account and shows as Leftover.</p>
            )}

            <div className="space-y-1.5">
              <TipLabel help="row.ruleFrom">Counts from</TipLabel>
              <MonthField label="Counts from" value={from} onChange={(m) => { if (m) setFrom(m) }} locale={locale} fromYear={startYear} className="max-w-xs" />
              <p className="text-xs text-muted-foreground">Earlier months keep their amounts. What was typed for {name} from {monthName} on is replaced.</p>
            </div>

            {figures && (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid="rule-preview">
                <dt className="text-muted-foreground">
                  {name} in {monthName}
                  {kind === 'share-of-income' && typedShare != null && <> · {formatShare(typedShare, locale)} of {money(figures.takeHome)} take-home income</>}
                  {kind === 'share-of-rest' && typedShare != null && <> · {formatShare(typedShare, locale)} of {money(figures.left)} left</>}
                </dt>
                <dd className="text-right tabular-nums" data-testid="rule-amount">{money(figures.amount)}</dd>
                {kind !== 'rest' && (
                  <>
                    <dt className="text-muted-foreground">{figures.rest != null ? (figures.rest < 0 ? 'Then taken back from the rest account' : `Then the rest${restRowName ? ` ("${restRowName}")` : ''}`) : figures.leftover < 0 ? 'Then short in the main account' : 'Then left in the main account'}</dt>
                    <dd className="text-right tabular-nums" data-testid="rule-rest">{money(Math.abs(figures.rest ?? figures.leftover))}</dd>
                  </>
                )}
              </dl>
            )}
            {(problem || error) && <p className="text-sm text-destructive" role="alert">{problem ?? error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{found.error ? 'Close' : 'Cancel'}</Button>
          {!found.error && <Button onClick={submit} disabled={busy || !choiceKey || !!problem}>Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
