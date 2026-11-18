import { PastChangeCancelled } from '@/store'

/**
 * What a failed action says on screen. A save cancelled at the question about the past (rule T4) is not a failure:
 * nothing was saved because you said so, and the dialog stays as you left it, so it says nothing (null).
 */
export function saveError(e: unknown, fallback: string): string | null {
  if (e instanceof PastChangeCancelled) return null
  return e instanceof Error ? e.message : fallback
}

/** For `.catch(...)`: shows what a failed action says, and nothing for a save cancelled at the question. */
export const showSaveError = (show: (message: string) => void, fallback: string) => (e: unknown): void => {
  const said = saveError(e, fallback)
  if (said) show(said)
}

/** What any error says, for what never saves (reading a file, a preview, the cloud). */
export function errorText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}
