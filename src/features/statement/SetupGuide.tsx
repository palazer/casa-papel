import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Island } from '@/components/ui/island'
import { cn } from '@/lib/utils'
import type { SetupStep, SetupStepKey } from '@/store'

/** What each step asks for: the prompt, and one sentence that says how. */
const STEP: Record<SetupStepKey, { title: string; text: string }> = {
  income: { title: 'Your first income', text: 'Type what comes in each month on a suggested line and press Enter. Amounts carry forward to the months after.' },
  expenses: { title: 'Your first expenses', text: 'Type what a usual month costs. A guess is fine: it shows as an estimate until you know.' },
  savings: { title: 'Savings, and where the rest goes', text: 'Add a savings account under Assets. It is then asked to take what is left of each month.' },
  virtual: { title: 'Your first virtual account', text: 'Money set aside inside savings for one purpose, like travel or clothes: add one under Assets with what goes in each month.' },
  investments: { title: 'Your first investment', text: 'Add an investment account under Assets. It then asks how much goes in each month.' },
  debts: { title: 'Loans and cards', text: 'Add what you owe under Debts. It comes with the row that pays it off.' },
}

/**
 * The guided setup (DESIGN.md §7): shown on the Statement while a household is new, and it stays at the top while the
 * page scrolls. It leads through the main things a household gives the page, one step at a time: the step's prompt and
 * one sentence, the steps as numbers (a tick once a step has what it asks for; pressing a number goes there), and
 * Back / Skip or Next. "Skip" moves on from a step that has nothing yet, "Next" from one that has; the last step ends
 * with "Finish". "Leave setup" puts the guide away for good. It changes nothing in the household itself. The screen
 * lights the part of the page the step is about and locks the rest (`setupFocus`), so the guide is also the way past
 * a lock: Skip, a number, or leaving.
 */
export function SetupGuide({ steps, current, action, onStep, onDone }: {
  steps: SetupStep[]
  /** The step the guide is on. */
  current: SetupStepKey
  /** What the step can do with one press, when there is such a thing ("Choose where the rest goes"). */
  action?: { label: string; run: () => void }
  onStep: (key: SetupStepKey) => void
  /** "Finish" and "Leave setup": the guide goes away. */
  onDone: () => void
}) {
  const at = Math.max(0, steps.findIndex((s) => s.key === current))
  const step = steps[at]
  const last = at === steps.length - 1
  const { title, text } = STEP[step.key]
  return (
    <Island
      title="Setting up" help="statement.setup" aria-label="Setting up" data-testid="setup-guide"
      className="sticky top-0 z-30 shadow-sm" bodyClassName="flex flex-wrap items-center gap-x-3 gap-y-1.5"
      right={(
        <span className="flex items-center gap-2">
          <span className="whitespace-nowrap tabular-nums" data-testid="setup-count">{at + 1} of {steps.length}</span>
          <Button size="xs" variant="ghost" onClick={onDone}>Leave setup</Button>
        </span>
      )}
    >
      {/* the steps as numbers: beside the prompt where there is room, on a line of their own on a phone */}
      <ol className="flex shrink-0 items-center gap-1 max-sm:basis-full">
        {steps.map((s, i) => (
          <li key={s.key}>
            <button
              type="button" onClick={() => onStep(s.key)} data-step={s.key} data-done={s.done} aria-current={i === at ? 'step' : undefined}
              aria-label={`Step ${i + 1}, ${s.label}: ${s.done ? 'done' : 'still to do'}`} title={s.label}
              className={cn(
                'inline-flex size-6 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-8',
                // the step the guide is on is the pressed one (DESIGN.md §1: the lime is for what is pressed)
                i === at ? 'border-transparent bg-primary text-primary-foreground hover:bg-primary' : 'text-muted-foreground',
              )}
            >
              {s.done ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </button>
          </li>
        ))}
      </ol>
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-sm font-medium" role="status" data-testid="setup-title">{title}</p>
        <p className="text-xs text-muted-foreground" data-testid="setup-text">{text}</p>
      </div>
      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
        {action && <Button size="sm" variant="outline" onClick={action.run}>{action.label}</Button>}
        <Button size="sm" variant="ghost" disabled={at === 0} onClick={() => onStep(steps[at - 1].key)}>Back</Button>
        {last
          ? <Button size="sm" variant={step.done ? 'default' : 'outline'} onClick={onDone}>Finish</Button>
          : <Button size="sm" variant={step.done ? 'default' : 'outline'} onClick={() => onStep(steps[at + 1].key)}>{step.done ? 'Next' : 'Skip'}</Button>}
      </div>
    </Island>
  )
}
