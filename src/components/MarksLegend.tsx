import type { ReactNode } from 'react'
import { CircleSlash, Link2, Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { HUES } from '@/app/hues'
import { useScreen } from '@/app/screens'
import { DoneDot } from './DoneDot'
import { ESTIMATE_SHADE } from '@/app/display'
import { cn } from '@/lib/utils'
import { txt } from '@/i18n'

const T = txt.components.legend

const KINDS = [
  { hue: HUES.income, label: txt.common.income },
  { hue: HUES.expense, label: txt.common.expenses },
  { hue: HUES.transfer, label: txt.common.transfers },
  { hue: HUES.worth, label: T.balancesAndNetWorth },
  { hue: HUES.pool, label: txt.common.virtualAccounts },
  { hue: HUES.goal, label: T.goals },
]

const H4 = 'mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground'

function Mark({ sample, children }: { sample: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      <span className="flex w-16 shrink-0 justify-end tabular-nums">{sample}</span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  )
}

/**
 * "Colours and marks" (DESIGN.md §5): the legend behind one quiet button at the right of the Statement and Grid toolbars.
 * Every kind of money has one hue, every mark one meaning; the samples use the same classes as the real cells.
 */
export function MarksLegend({ neg }: { neg: boolean }) {
  const { go, payments } = useScreen()
  // the hash names the Guide topic; the Guide scrolls there on arrival
  const moreInGuide = () => go('guide', '#guide-marks')
  return (
    <Popover>
      <PopoverTrigger render={<Button size="xs" variant="ghost" />}>{T.coloursAndMarks}</PopoverTrigger>
      <PopoverContent align="end" className="w-72 gap-3 p-3 text-xs">
        <section>
          <h4 className={H4}>{T.kindsOfMoney}</h4>
          <ul className="space-y-1">
            {KINDS.map((k) => (
              <li key={k.label} className="flex items-center gap-2">
                <span className={cn('size-2.5 shrink-0 rounded-full', k.hue.fill)} aria-hidden />
                <span className={k.hue.text}>{k.label}</span>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4 className={H4}>{T.marks}</h4>
          <ul className="space-y-1">
            <Mark sample={<span className={ESTIMATE_SHADE}>€210.00</span>}>{T.anEstimateOnThe}</Mark>
            <Mark sample={<span>€210.00</span>}>{T.certainYouKnowThe}</Mark>
            <Mark sample={<DoneDot done={1} total={1} state="all" />}>{T.doneTheMoneyHas}</Mark>
            <Mark sample={<span className="flex gap-1"><DoneDot done={0} total={1} state="none" /><DoneDot done={1} total={2} state="partial" /></span>}>{T.thisMonthOnlyNothing}</Mark>
            {neg && <Mark sample={<span className={HUES.expense.text}>-€210.00</span>}>{T.spendingShownAsA}</Mark>}
            <Mark sample={<span className="text-draw">+€120.00</span>}>{T.drawnFromSavingsThis}</Mark>
            <Mark sample={<span className={HUES.expense.text}>-€80.00</span>}>{T.aBalanceBelowZero}</Mark>
            <Mark sample={<span className="underline decoration-dotted underline-offset-4">€8,000.00</span>}>{T.aBalanceYouEntered}</Mark>
            <Mark sample={<span className="rounded bg-muted/60 px-1.5 py-0.5 text-muted-foreground">{T.sampleMonth}</span>}>{T.aMonthThatIs}</Mark>
            <Mark sample={<span className={cn('block h-4 w-14 rounded-sm ring-1 ring-border', HUES.expense.band)} aria-hidden />}>{T.aFaintBandThe}</Mark>
            <Mark sample={<Repeat className="size-3.5 text-muted-foreground" aria-hidden />}>{T.onAScheduleIt}</Mark>
            {payments && <Mark sample={<span className="text-[11px] text-muted-foreground">{T.sampleDay}</span>}>{T.theDayAnAmount}</Mark>}
            <Mark sample={<CircleSlash className="size-3.5 text-muted-foreground" aria-hidden />}>{T.notInNetWorth}</Mark>
            <Mark sample={<Link2 className="size-3.5 text-muted-foreground" aria-hidden />}>{T.linkedOnTheStatement}</Mark>
          </ul>
        </section>
        <Button size="xs" variant="ghost" className="self-start" onClick={moreInGuide}>{T.moreInTheGuide}</Button>
      </PopoverContent>
    </Popover>
  )
}
