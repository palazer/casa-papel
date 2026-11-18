import type { PastAnswer } from '@/store'
import { monthAtEnd, monthName, step } from '../registry'
import { ScenarioError } from '../world'

/**
 * Rule T4: the question before a change alters a month that is over. In a scenario tagged @T4 the app asks as it
 * does on screen; the save that asks waits for the step that answers it ("I answer the question about the past with
 * …"). A "Given" that the next step does not ask about is answered "Save anyway" by itself: it only sets the scene.
 */

/** "March 2026, April 2026 and May 2026" → the months. */
function monthsIn(text: string) {
  return text.split(/, | and /).map((part) => {
    const m = monthAtEnd(part.trim())
    if (!m) throw new ScenarioError(`"${part}" is not a month: write them as "March 2026, April 2026 and May 2026".`)
    return m
  })
}

const ANSWERS: Record<string, PastAnswer> = { Cancel: 'cancel', 'Save anyway': 'save' }

step('I am asked before it is saved, with {} listed', (world, months: string) => {
  const q = world.asking?.question
  if (!q) throw new Error(world.asked ? 'The question was answered already.' : 'Nothing was asked: it was saved at once.')
  const want = monthsIn(months)
  const got = q.changes.months
  if (got.join() !== want.join()) throw new Error(`The question lists ${got.map(monthName).join(', ') || 'no month'}, not ${want.map(monthName).join(', ')}.`)
})

step('I am not asked anything', (world) => {
  if (world.asked) throw new Error(`I was asked about ${world.asked.changes.months.map(monthName).join(', ')}.`)
})

step('I answer the question about the past with {string}', async (world, said: string) => {
  const answer = ANSWERS[said] ?? (/^Only from .+ on$/.test(said) ? 'from-now' : null)
  if (!answer) throw new ScenarioError(`The question offers "Cancel", "Save anyway" and "Only from <Month> on", not "${said}".`)
  await world.answer(answer)
})

/** Whether a step's text is one about the question, so that the step before it leaves the question open. */
export const isQuestionStep = (text: string): boolean => /^I am asked before it is saved\b|^I answer the question about the past\b/.test(text)
