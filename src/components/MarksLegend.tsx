import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { HUES } from '@/app/hues'
import { useScreen } from '@/app/screens'
import { DoneDot } from './DoneDot'
import { statusClass } from '@/app/display'
import { cn } from '@/lib/utils'

const KINDS = [
  { hue: HUES.income, label: 'Income' },
  { hue: HUES.expense, label: 'Expenses' },
  { hue: HUES.transfer, label: 'Transfers' },
  { hue: HUES.worth, label: 'Balances and net worth' },
  { hue: HUES.pool, label: 'Pool accounts' },
  { hue: HUES.goal, label: 'Goals' },
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
 * "What the colours and marks mean" (DESIGN.md §5): the legend behind one button in the Grid and Month toolbars.
 * Every kind of money has one hue, every mark one meaning; the samples use the same classes as the real cells.
 */
export function MarksLegend({ neg }: { neg: boolean }) {
  const { go } = useScreen()
  // the hash names the Guide topic; the Guide scrolls there on arrival
  const moreInGuide = () => go('guide', '#guide-marks')
  return (
    <Popover>
      <PopoverTrigger render={<Button size="xs" variant="outline" />}>What the colours and marks mean</PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-3 p-3 text-xs">
        <section>
          <h4 className={H4}>Kinds of money</h4>
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
          <h4 className={H4}>Marks</h4>
          <ul className="space-y-1">
            <Mark sample={<span className={statusClass.projected}>€210.00</span>}>An estimate: italic, dashed underline</Mark>
            <Mark sample={<span>€210.00</span>}>Certain: you know the amount</Mark>
            <Mark sample={<DoneDot done={1} total={1} state="all" />}>Done: the money has moved</Mark>
            <Mark sample={<span className="flex gap-1"><DoneDot done={0} total={1} state="none" /><DoneDot done={1} total={2} state="partial" /></span>}>This month only: nothing done yet, partly done</Mark>
            {neg && <Mark sample={<span className={HUES.expense.text}>-€210.00</span>}>Spending, shown as a negative number</Mark>}
            <Mark sample={<span className="text-draw">+€120.00</span>}>Drawn from savings this month</Mark>
            <Mark sample={<span className={HUES.expense.text}>-€80.00</span>}>A balance below zero: a pool account or savings in the red</Mark>
            <Mark sample={<span className="underline decoration-dotted underline-offset-4">€8,000.00</span>}>A balance you entered yourself</Mark>
            <Mark sample={<span className="flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-muted-foreground"><Lock className="size-3" aria-hidden />Sept</span>}>A closed month: locked, all of it counts as done</Mark>
            <Mark sample={<span className={cn('block h-4 w-14 rounded-sm ring-1 ring-border', HUES.expense.band)} aria-hidden />}>A faint band: the rows of one category</Mark>
          </ul>
        </section>
        <Button size="xs" variant="ghost" className="self-start" onClick={moreInGuide}>More in the Guide</Button>
      </PopoverContent>
    </Popover>
  )
}
