import type { HelpKey, HelpText } from '@/app/help'
import type { GuideTopic } from '@/app/guide'

/** A slice of a text to wrap in `<mark>`: `[start, end)`. */
export type Range = [number, number]

/** One topic the query matched: how often, whether in its title, and one line around the first hit. */
export interface GuideHit {
  topic: GuideTopic
  count: number
  inTitle: boolean
  snippet: string
}

/** The query as lowercase words; an empty query has none. */
export const queryWords = (query: string): string[] => query.toLowerCase().split(/\s+/).filter(Boolean)

/** Every text a topic is searched by, in reading order: title, summary, paragraphs, steps, facts and the related tips. */
export function topicTexts(topic: GuideTopic, help: Record<HelpKey, HelpText>): string[] {
  return [
    topic.title,
    topic.summary,
    ...topic.what,
    ...topic.steps,
    ...(topic.facts ?? []).flatMap((f) => [f.label, f.text]),
    ...topic.tips.flatMap((k) => [help[k].title, help[k].text]),
  ]
}

/** A topic matches when every word of the query appears somewhere in its texts (case-insensitive, substrings). */
export function topicMatches(topic: GuideTopic, words: string[], help: Record<HelpKey, HelpText>): boolean {
  if (words.length === 0) return true
  const hay = topicTexts(topic, help).join('\n').toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** Lowercase that keeps every index in place: a character whose lowercase form is longer (İ) stays as it is. */
const fold = (s: string): string => Array.from(s, (ch) => { const l = ch.toLowerCase(); return l.length === ch.length ? l : ch }).join('')

/** Where the words occur in one text, as non-overlapping ranges in order, longer words first so "pool" inside "pools" is one mark. */
export function highlightRanges(text: string, words: string[]): Range[] {
  const lower = fold(text)
  const found: Range[] = []
  for (const w of [...words].sort((a, b) => b.length - a.length)) {
    if (!w) continue
    let from = 0
    for (;;) {
      const at = lower.indexOf(w, from)
      if (at < 0) break
      const range: Range = [at, at + w.length]
      if (!found.some(([s, e]) => range[0] < e && range[1] > s)) found.push(range)
      from = at + w.length
    }
  }
  return found.sort((a, b) => a[0] - b[0])
}

/** How many times the words occur across the texts. */
export const countHits = (texts: string[], words: string[]): number => texts.reduce((n, t) => n + highlightRanges(t, words).length, 0)

/**
 * The gray line of a result: the first text after the title that holds a word (the summary when only the title does),
 * cut to about `radius` characters either side of the first hit, at word boundaries, with "…" where it was cut.
 */
export function snippetFor(texts: string[], words: string[], radius = 56): string {
  const [, ...body] = texts
  const source = body.find((t) => highlightRanges(t, words).length > 0) ?? body[0] ?? ''
  const [s, e] = highlightRanges(source, words)[0] ?? [0, 0]
  let from = Math.max(0, s - radius)
  let to = Math.min(source.length, Math.max(e + radius, radius * 2))
  if (from > 0 && source[from - 1] !== ' ') {
    const sp = source.indexOf(' ', from)
    if (sp >= 0 && sp < s) from = sp + 1
  }
  if (to < source.length) {
    const sp = source.lastIndexOf(' ', to)
    if (sp > e) to = sp
  }
  return `${from > 0 ? '…' : ''}${source.slice(from, to)}${to < source.length ? '…' : ''}`
}

/**
 * The topics the query leaves, best first: a hit in the title, then the most hits, ties in guide order. An empty
 * query leaves them all in guide order with no hits.
 */
export function searchGuide(topics: GuideTopic[], query: string, help: Record<HelpKey, HelpText>): GuideHit[] {
  const words = queryWords(query)
  const hits = topics.flatMap((topic, index) => {
    if (!topicMatches(topic, words, help)) return []
    const texts = topicTexts(topic, help)
    return [{ topic, index, count: countHits(texts, words), inTitle: highlightRanges(topic.title, words).length > 0, snippet: snippetFor(texts, words) }]
  })
  if (words.length > 0) hits.sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.count - a.count || a.index - b.index)
  return hits.map(({ topic, count, inTitle, snippet }) => ({ topic, count, inTitle, snippet }))
}
