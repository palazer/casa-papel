import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InfoTip, TipLabel } from '@/components/InfoTip'
import { MonthField } from '@/components/MonthField'
import { NativeSelect } from '@/components/NativeSelect'
import { Segmented } from '@/components/Segmented'
import { amountToInput, formatAmount, formatMonth, formatShare, parseAmount } from '@/app/format'
import { useStore } from '@/app/store'
import { cellKey, computeEngine } from '@/engine'
import { addMonths, compareMonths, isShareRule, parseMonth, poolRowName, type Household, type MonthKey, type Tables } from '@/model'
import { previewRule, setRule, type RuleChoice, type RuleTarget } from '@/store'
import { useSave } from '@/features/grid/RowDialogs'
import { ruleFacts, type RuleFacts, type RuleKind } from './ruleFacts'

/**
 * What the fields say, as text (`fixed:30000`, `share-of-income:0.1`, `share-of-row:1:<income row>`, `rest`): a plain
 * value the preview can depend on. Null while a field is empty or cannot be read, or no income is picked.
 */
function choiceKeyOf(kind: RuleKind, amount: number | null, share: number | null, ofRowId: string): string | null {
  if (kind === 'rest') return 'rest'
  if (kind === 'fixed') return amount != null ? `fixed:${amount}` : null
  if (share == null || !Number.isFinite(share)) return null
  if (kind === 'share-of-row') return ofRowId ? `${kind}:${share}:${ofRowId}` : null
  return `${kind}:${share}`
}

function choiceOf(key: string): RuleChoice {
  const [kind, value, ...rest] = key.split(':')
  if (kind === 'fixed') return { kind, amount: Number(value) }
  if (kind === 'share-of-row') return { kind, share: Number(value), rowId: rest.join(':') }
  if (kind === 'share-of-income' || kind === 'share-of-own-income' || kind === 'share-of-rest') return { kind, share: Number(value) }
  return { kind: 'rest' }
}

/** A stored fraction as the field shows it: to a tenth of a percent. */
const shareInput = (share: number): string => String(Math.round(share * 1000) / 10)

/**
 * "How the amount is set" (DESIGN.md §8): a fixed amount, a percentage of income, a percentage of one income line, a
 * percentage of what is left, or the rest; for an adult's pocket money never the rest, and a percentage of that
 * adult's own income as well. It opens the dialog of every row that can carry a rule; the fields of the choice follow it.
 */
export function RulePicker({ facts, kind, onKind }: { facts: RuleFacts; kind: RuleKind; onKind: (kind: RuleKind) => void }) {
  /** What a month that overruns does to the account that takes the rest, in that account's own terms. */
  const shortMonth = facts.pool
    ? `A month that overruns takes the difference back out of ${facts.name}.`
    : facts.account?.type === 'investment'
      ? `A month that overruns takes the difference back out of ${facts.name}: it shows as money taken out of the investments.`
      : `A month that overruns takes the difference back from ${facts.name}.`
  return (
    <fieldset className="space-y-1.5">
      <legend className="flex items-center gap-1 text-sm font-medium">How the amount is set <InfoTip help="row.rule" /></legend>
      <Segmented label="How the amount is set" value={kind} onChange={(v) => onKind(v as RuleKind)} options={facts.kinds.map(({ value, label }) => ({ value, label }))} />
      <p className="text-xs text-muted-foreground">{facts.kinds.find((k) => k.value === kind)?.text}{kind === 'rest' ? ` ${shortMonth}` : ''}</p>
    </fieldset>
  )
}

interface FieldsProps {
  tables: Tables
  household: Household
  target: RuleTarget
  facts: RuleFacts
  /** The month the dialog was opened from: the rule counts from there unless another month is picked. */
  month: MonthKey
  kind: RuleKind
  onClose: () => void
}

/**
 * The fields of a rule and the buttons that save it: the amount or the percentage, the month it counts from, and what
 * that month would then show. The rule is run on a copy first, so the figure and every refusal are the ones saving
 * would give. It sits inside a dialog, under the picker.
 */
export function RuleFields({ tables, household, target, facts, month, kind, onClose }: FieldsProps) {
  const store = useStore()
  const { locale, baseCurrency: base } = household
  const { row, name, adult, ccy, hasRest, othersOfRest, restRowName } = facts

  // a closed month cannot start a rule: begin after the last closed month
  const lastClosed = tables.monthStates.filter((s) => s.closed).map((s) => s.month).sort().at(-1)
  const earliest = compareMonths(month, household.startMonth) < 0 ? household.startMonth : month
  const [from, setFrom] = useState<MonthKey>(lastClosed && compareMonths(lastClosed, earliest) >= 0 ? addMonths(lastClosed, 1) : earliest)
  /** What the row shows in the month the dialog was opened from: the amount a fixed rule starts from. */
  const shown = useMemo(() => (row ? computeEngine({ tables, months: [month] }).cells[cellKey(row.id, month)] : undefined), [tables, row, month])
  const [amountText, setAmountText] = useState(facts.current === 'fixed' && shown && shown.value > 0 ? amountToInput(shown.value, shown.currency, locale) : '')
  const seededShare = facts.share != null ? shareInput(facts.share) : ''
  const [shareText, setShareText] = useState(seededShare)
  /** For a share of one income: the income line picked, the one its rule names now or the first there is. */
  const [ofRowId, setOfRowId] = useState(facts.ofRowId && facts.incomes.some((i) => i.id === facts.ofRowId) ? facts.ofRowId : facts.incomes[0]?.id ?? '')
  const ofName = facts.incomes.find((i) => i.id === ofRowId)?.name
  const { error, busy, save } = useSave(onClose)

  const share = isShareRule(kind)
  // an untouched field keeps the stored fraction exactly
  const typedShare = shareText.trim() === '' ? null : shareText === seededShare && facts.share != null ? facts.share : Number(shareText.replace(',', '.')) / 100
  const typedAmount = amountText.trim() === '' ? null : parseAmount(amountText, ccy, locale)
  const choiceKey = choiceKeyOf(kind, typedAmount, typedShare, ofRowId)
  const typedSomething = kind === 'fixed' ? amountText.trim() !== '' : share && shareText.trim() !== ''
  const fieldError = !choiceKey && typedSomething ? 'That is not a number I can read.' : null
  /** The rule tried on a copy: what the start month would show, or why it cannot be saved. */
  const preview = useMemo(() => {
    if (!choiceKey) return null
    try {
      const { row: r, engine } = previewRule(tables, target, choiceOf(choiceKey), from, [from])
      const t = engine.totals[from]
      return { amount: engine.cells[cellKey(r.id, from)]?.valueBase ?? 0, takeHome: t.takeHome, own: t.takeHomeBy[r.scope] ?? 0, of: ofRowId ? engine.cells[cellKey(ofRowId, from)]?.netBase ?? 0 : 0, left: t.leftForShares, rest: t.rest, leftover: t.leftover }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'That rule cannot be saved.' }
    }
  }, [tables, target, from, choiceKey, ofRowId])
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
    <>
      <div className="space-y-4">
        {kind === 'fixed' && (
          <div className="space-y-1.5">
            <Label htmlFor="rule-amount">Amount per month in {ccy}</Label>
            <Input id="rule-amount" className="w-40" autoFocus inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder="e.g. 300" />
          </div>
        )}
        {kind === 'share-of-row' && (facts.incomes.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor="rule-of">Which income</Label>
            <NativeSelect id="rule-of" className="w-full max-w-xs" value={ofRowId} onChange={(e) => setOfRowId(e.target.value)}>
              {facts.incomes.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </NativeSelect>
            {facts.ofRowId && !facts.incomes.some((i) => i.id === facts.ofRowId) && (
              <p className="text-xs text-muted-foreground" data-testid="rule-income-gone">The income this was a percentage of is no longer there, so nothing comes of it now. Saving takes it of the income picked here.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="rule-no-income">There is no income line yet to take a percentage of. Add one under Income first.</p>
        ))}
        {share && (kind !== 'share-of-row' || facts.incomes.length > 0) && (
          <div className="space-y-1.5">
            <Label htmlFor="rule-share">{kind === 'share-of-income' ? 'Percentage of income' : kind === 'share-of-own-income' ? (adult ? `Percentage of ${adult.name}'s income` : 'Percentage of their own income') : kind === 'share-of-row' ? 'Percentage of that income' : 'Percentage of what is left'}</Label>
            <Input id="rule-share" className="w-28" autoFocus={kind !== 'share-of-row'} inputMode="decimal" value={shareText} onChange={(e) => setShareText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} placeholder={kind === 'share-of-row' ? 'e.g. 100' : 'e.g. 10'} />
            {kind === 'share-of-rest' && othersOfRest > 0 && <p className="text-xs text-muted-foreground">Other accounts and pocket money already take {formatShare(othersOfRest, locale)} of what is left.</p>}
          </div>
        )}
        {kind === 'rest' && !hasRest && restRowName && (
          <p className="text-xs text-muted-foreground">&quot;{restRowName}&quot; takes the rest now. From {monthName} on it comes here instead, and &quot;{restRowName}&quot; gets nothing more until you give it a rule of its own.</p>
        )}
        {kind !== 'rest' && hasRest && (
          <p className="text-xs text-muted-foreground">{name} takes the rest now. With this rule no account does: from {monthName} on the rest stays in the main account and shows as Leftover.</p>
        )}
        {facts.wasShareOfTotal && (
          <p className="text-xs text-muted-foreground">Until now it was a share of the household&apos;s pocket money total; from the month below on it has an amount of its own.</p>
        )}

        <div className="space-y-1.5">
          <TipLabel help="row.ruleFrom">Counts from</TipLabel>
          <MonthField label="Counts from" value={from} onChange={(m) => { if (m) setFrom(m) }} locale={locale} fromYear={startYear} className="max-w-xs" />
          <p className="text-xs text-muted-foreground">Earlier months keep their amounts. What was typed for {name} from {monthName} on is replaced.</p>
        </div>

        {figures && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid="rule-preview">
            <dt className="text-muted-foreground">
              {figures.amount < 0 ? `Taken back from ${name}` : name} in {monthName}
              {kind === 'share-of-income' && typedShare != null && <> · {formatShare(typedShare, locale)} of {money(figures.takeHome)} take-home income</>}
              {kind === 'share-of-own-income' && typedShare != null && <> · {formatShare(typedShare, locale)} of {money(figures.own)}, {adult ? `${adult.name}'s` : 'their own'} take-home income</>}
              {kind === 'share-of-row' && typedShare != null && <> · {formatShare(typedShare, locale)} of {money(figures.of)}{ofName ? `, ${ofName}` : ''}</>}
              {kind === 'share-of-rest' && typedShare != null && <> · {formatShare(typedShare, locale)} of {money(figures.left)} left</>}
            </dt>
            <dd className="text-right tabular-nums" data-testid="rule-amount">{money(Math.abs(figures.amount))}</dd>
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
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={submit} disabled={busy || !choiceKey || !!problem}>Save</Button>
      </DialogFooter>
    </>
  )
}

interface Props {
  tables: Tables
  household: Household
  /** The account or virtual account whose transfer gets the rule (or the row, which has the amount dialog instead). */
  target: RuleTarget
  /** The month the dialog was opened from: the rule counts from there unless another month is picked. */
  month: MonthKey
  /** For an account that was just added: the choice the dialog opens on, instead of what its transfer has now. */
  start?: RuleKind
  onClose: () => void
}

/**
 * How much goes to an account that no row fills yet (DESIGN.md §8): the picker and the fields of a rule by
 * themselves, and saving adds the row. A row that exists has one dialog for its amount and its rule, the cell editor,
 * which hosts the same two parts.
 */
export function RuleDialog({ tables, household, target: given, month, start, onClose }: Props) {
  // one dialog, one target: held so a parent that builds the object on every render does not rerun the engine
  const [target] = useState(given)
  const facts = useMemo(() => ruleFacts(tables, household, target), [tables, household, target])
  const { row, name, pocket, adult, pool } = facts
  const [kind, setKind] = useState<RuleKind>(start ?? facts.current)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{pocket ? (adult ? `How much pocket money does ${adult.name} get?` : `How much is ${name}?`) : `How much goes to ${name}?`}</DialogTitle>
          <DialogDescription>
            {facts.error ?? (row ? <>Row &quot;{row.name}&quot;. Each month the app works the amount out from the rule you pick.</> : <>Nothing moves money to {name} yet. Saving adds the row &quot;{pool ? poolRowName(pool.name) : `To ${name}`}&quot; under Transfers.</>)}
          </DialogDescription>
        </DialogHeader>
        {facts.error ? (
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Close</Button>
          </DialogFooter>
        ) : (
          <>
            <RulePicker facts={facts} kind={kind} onKind={setKind} />
            <RuleFields tables={tables} household={household} target={target} facts={facts} month={month} kind={kind} onClose={onClose} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
