import { Fragment, useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Island } from '@/components/ui/island'
import { GroupTabs } from '@/components/GroupTabs'
import { PageHeader } from '@/components/PageHeader'
import { GUIDE, GUIDE_LEAD, REPO_URL, type GuideTopic } from '@/app/guide'
import { HELP } from '@/app/help'
import { screenDef, useScreen } from '@/app/screens'
import { isDemoMode, openDemoSandbox } from '@/app/store'
import { highlightRanges, queryWords, searchGuide } from './search'
import { guideLang, lang, txt } from '@/i18n'

const T = txt.guide.screen
/** The Guide's own text is marked with its language while that is not the page's (DESIGN.md §13). */
const GUIDE_TEXT = guideLang === lang ? undefined : guideLang

/** A text with the query's words wrapped in `<mark>`; the plain text when nothing is searched. */
function Highlight({ text, words }: { text: string; words: string[] }) {
  const ranges = words.length > 0 ? highlightRanges(text, words) : []
  if (ranges.length === 0) return <>{text}</>
  const parts: ReactNode[] = []
  let at = 0
  ranges.forEach(([s, e], i) => {
    if (s > at) parts.push(text.slice(at, s))
    parts.push(<mark key={i} className="rounded-sm bg-primary/30 text-inherit">{text.slice(s, e)}</mark>)
    at = e
  })
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}

/** A list of `label: text` pairs (a topic's facts, its related tips). */
function Pairs({ title, items, words, textLang }: { title: string; items: Array<{ label: string; text: string }>; words: string[]; textLang?: string }) {
  return (
    <div>
      <h4 className="text-xs font-medium">{title}</h4>
      <dl lang={textLang} className="mt-1 grid gap-x-4 gap-y-1 text-xs leading-4 sm:grid-cols-[max-content_1fr]">
        {items.map((it) => (
          <Fragment key={it.label}>
            <dt className="font-medium"><Highlight text={it.label} words={words} /></dt>
            <dd className="text-muted-foreground"><Highlight text={it.text} words={words} /></dd>
          </Fragment>
        ))}
      </dl>
    </div>
  )
}

function Topic({ topic, words, go }: { topic: GuideTopic; words: string[]; go: (s: GuideTopic['open']) => void }) {
  return (
    <Island air as="section" id={`guide-${topic.key}`} title={<span lang={GUIDE_TEXT}><Highlight text={topic.title} words={words} /></span>} description={<span lang={GUIDE_TEXT}><Highlight text={topic.summary} words={words} /></span>}>
      <div className="space-y-3 text-sm leading-6">
        {topic.what.map((p) => <p key={p.slice(0, 32)} lang={GUIDE_TEXT}><Highlight text={p} words={words} /></p>)}
        <ol lang={GUIDE_TEXT} className="list-decimal space-y-1 pl-5">
          {topic.steps.map((s) => <li key={s.slice(0, 32)}><Highlight text={s} words={words} /></li>)}
        </ol>
        {topic.facts && <Pairs title={topic.factsTitle ?? T.theChoices} items={topic.facts} words={words} textLang={GUIDE_TEXT} />}
        {topic.tips.length > 0 && <Pairs title={T.relatedTips} items={topic.tips.map((k) => ({ label: HELP[k].title, text: HELP[k].text }))} words={words} />}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="xs" variant="outline" onClick={() => go(topic.open)}>{T.open(screenDef(topic.open).label)}</Button>
          <a href="#guide-topics" className={buttonVariants({ size: 'xs', variant: 'ghost' })}>{T.topics}</a>
        </div>
      </div>
    </Island>
  )
}

/**
 * The Guide (DESIGN.md §2): a reading page that opens without a household. The lead says what Casa Papel is, the
 * contents list the topics, and each topic is an island with its paragraphs, numbered steps naming the controls, the
 * model's own option texts where it explains a choice, the related (i) texts from `HELP`, and an "Open <screen>"
 * button. The search field in the header filters the topics as you type over all of that and marks the words; a
 * results list under it (title, hit count, one gray line around the first hit) jumps to each topic.
 */
export function GuideScreen() {
  const { go } = useScreen()
  const [query, setQuery] = useState('')
  const words = useMemo(() => queryWords(query), [query])
  const hits = useMemo(() => searchGuide(GUIDE, query, HELP), [query])
  const topics = useMemo(() => hits.map((h) => h.topic), [hits])
  const searching = words.length > 0

  // the address's hash names a topic (`#guide-marks` from the legend, `#guide-virtual-accounts` from the contents): scroll to it on
  // arrival and when it changes; `screenHref` drops a `#guide-…` hash when another screen opens
  useEffect(() => {
    const jump = () => {
      const id = window.location.hash.slice(1)
      if (id.startsWith('guide-')) document.getElementById(id)?.scrollIntoView({ block: 'start' })
    }
    jump()
    window.addEventListener('hashchange', jump)
    return () => window.removeEventListener('hashchange', jump)
  }, [])

  const shown = query.trim()
  const status = !searching ? null
    : topics.length === 0 ? T.nothingMatchesTryAnother(shown)
      : T.topicsMatch(topics.length, shown)
  const keys = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Escape') setQuery('') }

  return (
    <div className="space-y-4">
      <PageHeader title={T.guide} subline={T.howCasaPapelWorks} controls={false}>
        <Input type="search" aria-label={T.searchTheGuide} placeholder={T.searchTheGuide} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={keys} className="h-7 w-64 max-md:w-full" />
        {status && <p role="status" className="basis-full text-muted-foreground">{status}</p>}
      </PageHeader>
      <GroupTabs />
      <div className="mx-auto max-w-3xl space-y-4 text-xs">
        {!searching && (
          <Island air title={<span lang={GUIDE_TEXT}>{GUIDE_LEAD.title}</span>}>
            <div lang={GUIDE_TEXT} className="space-y-2 text-sm leading-6">
              {GUIDE_LEAD.paragraphs.map((p) => <p key={p.slice(0, 24)}>{p}</p>)}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!isDemoMode() && <Button size="xs" variant="outline" onClick={openDemoSandbox}>{T.tryTheDemo}</Button>}
              <a href={REPO_URL} target="_blank" rel="noreferrer" className={buttonVariants({ size: 'xs', variant: 'ghost' })}>{T.openOnGithub}</a>
            </div>
          </Island>
        )}
        {!searching && (
          <Island air as="div" title={T.topics}>
            <nav id="guide-topics" aria-label={T.topics} lang={GUIDE_TEXT} className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {GUIDE.map((t) => (
                <a key={t.key} href={`#guide-${t.key}`} className="group rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="text-sm font-medium text-foreground group-hover:underline">{t.title}</span>
                  <span className="block text-xs leading-4 text-muted-foreground">{t.summary}</span>
                </a>
              ))}
            </nav>
          </Island>
        )}
        {searching && hits.length > 0 && (
          <nav aria-label={T.results} className="rounded-lg border bg-card">
            <ul lang={GUIDE_TEXT} className="divide-y divide-border/60">
              {hits.map((h) => (
                <li key={h.topic.key}>
                  <a href={`#guide-${h.topic.key}`} className="block rounded-lg px-4 py-2 outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="flex items-baseline gap-3">
                      <span className="text-sm font-medium text-foreground"><Highlight text={h.topic.title} words={words} /></span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">{h.count}</span>
                    </span>
                    <span className="block text-xs leading-4 text-muted-foreground"><Highlight text={h.snippet} words={words} /></span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {topics.map((t) => <Topic key={t.key} topic={t} words={words} go={go} />)}
      </div>
    </div>
  )
}
