import { Check, Circle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Island } from '@/components/ui/island'
import { cn } from '@/lib/utils'
import type { SetupStep, SetupStepKey } from '@/store'

/** What to do next, said behind the strip's (i): the first step that is still open, in the order a household is filled. */
const NEXT: Record<SetupStepKey, string> = {
  income: 'Start with what comes in: under Income, type the monthly amount on a suggested line and press Enter, or use "Add row" for your own.',
  accounts: 'Next, the accounts: under Assets add each one with what it holds, and under Debts a card or a loan with what is owed.',
  expenses: 'Then what goes out: each category under Expenses offers its usual rows. An amount you are not sure of is fine, it shows as an estimate.',
  rest: 'Last, where the rest of each month goes: press this step, or the symbol beside an account under Assets, and choose "The rest".',
  goals: 'Everything a month needs is there. A goal can be set from any line under Assets or Debts. "Done" puts this strip away.',
}

/**
 * The setup strip (DESIGN.md §7): shown on the Statement while a household is new. It lists the parts of the page a
 * household fills, ticks each one once it has something in it, and jumps to a part when its step is pressed. It
 * changes nothing itself; "Done" hides it for good. The strip shows its steps and nothing else: what to do next, and
 * which month is being filled in, are behind its (i).
 */
export function SetupStrip({ steps, monthName, first, noSavings, onStep, onDone }: {
  steps: SetupStep[]
  /** The month on screen, in words. */
  monthName: string
  /** That month is the household's first one. */
  first: boolean
  /** No savings account yet, so nothing can take the rest. */
  noSavings: boolean
  onStep: (key: SetupStepKey) => void
  onDone: () => void
}) {
  const next = steps.find((s) => !s.done && !s.optional)?.key ?? 'goals'
  const hint = next === 'rest' && noSavings ? 'Last, where the rest of each month goes: add a savings account under Assets, and it is asked right away.' : NEXT[next]
  return (
    <Island
      title="Setting up" help="statement.setup" aria-label="Setting up" data-testid="setup-strip"
      helpText={`${hint} You are filling in ${monthName}${first ? ', the first month' : ''}. Amounts carry forward to the months after it.`}
      right={<Button size="xs" variant="outline" onClick={onDone}>Done</Button>}
    >
      <ol className="flex flex-wrap items-center gap-1">
        {steps.map((s) => (
          <li key={s.key}>
            <button
              type="button" onClick={() => onStep(s.key)} data-step={s.key} data-done={s.done}
              aria-label={`${s.label}${s.optional ? ' (optional)' : ''}: ${s.done ? 'done' : 'still to do'}`}
              className={cn(
                'inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-9',
                s.done ? 'text-muted-foreground' : 'font-medium',
              )}
            >
              {s.done ? <Check className="size-3.5 text-income" aria-hidden /> : <Circle className="size-3.5 text-muted-foreground" aria-hidden />}
              {s.label}{s.optional && <span className="font-normal text-muted-foreground">(optional)</span>}
            </button>
          </li>
        ))}
      </ol>
    </Island>
  )
}
