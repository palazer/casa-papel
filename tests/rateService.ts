/**
 * A stand-in for the rate service (frankfurter.dev, the ECB's reference rates), for tests and scenarios: it answers
 * from the daily rates it is given, the way the real one was seen to answer on 18 November 2026:
 *
 * - a range `/v1/<start>..<end>` gives every published day in it. When `start` is a day without a rate (a weekend, a
 *   holiday), the answer begins with the last published day before it;
 * - a symbol it does not know is left out of an answer that has the others, without a word; when it knows none of
 *   the symbols asked for, it answers 404;
 * - only currency codes and dates are in the address.
 *
 * `daily` is read at the time of each call, so a test can add days as its calendar moves on. `calls` collects the
 * addresses asked for.
 */
export function rateService(daily: Record<string, Record<string, number>>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const asked = /\/v1\/(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})\?base=([A-Z]{3})&symbols=([A-Z,%2C]+)$/.exec(url)
    if (!asked) return new Response('not found', { status: 404 })
    const [, start, end, base, list] = asked
    const symbols = decodeURIComponent(list).split(',')
    const days = Object.keys(daily).sort()
    const known = new Set(days.flatMap((d) => Object.keys(daily[d])))
    if (!symbols.some((s) => known.has(s))) return new Response('not found', { status: 404 })
    const before = days.filter((d) => d <= start).at(-1)
    const from = before ?? start
    const rates: Record<string, Record<string, number>> = {}
    for (const d of days) {
      if (d < from || d > end) continue
      const row = Object.fromEntries(Object.entries(daily[d]).filter(([s]) => symbols.includes(s)))
      if (Object.keys(row).length) rates[d] = row
    }
    const got = Object.keys(rates)
    return new Response(JSON.stringify({ base, start_date: got[0] ?? start, end_date: got.at(-1) ?? end, rates }), { status: 200 })
  }) as unknown as typeof fetch
}

/** The working days of a month as the tests need them: its first and its last day with a rate, for a month in `YYYY-MM`. */
export function monthEnds(month: string, first: number, last: number, symbol = 'USD'): Record<string, Record<string, number>> {
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
  // the second and the last but one: never a day the next or the previous month could claim
  return { [`${month}-02`]: { [symbol]: first }, [`${month}-${String(lastDay - 1).padStart(2, '0')}`]: { [symbol]: last } }
}
