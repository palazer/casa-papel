import { vi } from 'vitest'

/**
 * The day the suite runs on. Normally the real one; `CASA_TODAY=2027-03-15T12:00:00 npx vitest run` moves it, so that
 * a test that only passes in some months shows up. Only the date is replaced (and it stands still): timers are left
 * alone, because the in-memory database needs the real ones.
 */
export function restoreToday(): void {
  if (process.env.CASA_TODAY) vi.setSystemTime(new Date(process.env.CASA_TODAY))
  else vi.useRealTimers()
}

/** For a test whose outcome depends on today: give it its day, and call `restoreToday` in an `afterEach`. */
export function setToday(day: string): void {
  vi.setSystemTime(new Date(`${day}T12:00:00`))
}
