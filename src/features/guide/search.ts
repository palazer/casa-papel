import type { HelpKey, HelpText } from '@/app/help'
import type { GuideTopic } from '@/app/guide'

/** A slice of a text to wrap in `<mark>`: `[start, end)`. */
export type Range = [number, number]

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

/** The topics the query leaves, in their own order; an empty query leaves them all. */
export const searchGuide = (topics: GuideTopic[], query: string, help: Record<HelpKey, HelpText>): GuideTopic[] => {
  const words = queryWords(query)
  return topics.filter((t) => topicMatches(t, words, help))
}

/** Where the words occur in one text, as non-overlapping ranges in order, longer words first so "pool" inside "pools" is one mark. */
export function highlightRanges(text: string, words: string[]): Range[] {
  const lower = text.toLowerCase()
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
