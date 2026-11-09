import { memo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { isDemoMode, leaveDemoSandbox } from '@/app/store'
import { RAIL, groupOf, screenDef, screenHref, setSettingsOpen, settingsOpen, settingsPage, useScreen, type RailItem, type Screen, type ScreenDef } from '@/app/screens'
import { Chip } from '@/components/ui/chip'
import { cn } from '@/lib/utils'
import { follow, labelClass, monogram, tileClass } from './railStyles'

const ITEM = 'group flex w-16 flex-col items-center gap-0.5 rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring'

const RailLink = memo(function RailLink({ item, active, small = false, go }: { item: ScreenDef; active: boolean; small?: boolean; go: (s: Screen) => void }) {
  const Icon = item.icon
  return (
    <a href={screenHref(item.key)} onClick={(e) => follow(e, () => go(item.key))} aria-current={active ? 'page' : undefined} title={item.label} className={ITEM}>
      <span className={tileClass(active, small ? 'small' : 'rail')}>
        <Icon size={small ? 18 : 20} strokeWidth={active ? 2.5 : 2} aria-hidden />
      </span>
      <span className={labelClass(active)}>{item.label}</span>
    </a>
  )
})

/**
 * A group in the rail (after nfl-fantasy's Research): an accordion. A click on it folded unfolds it and opens the page
 * open last in the group; a click on it unfolded only folds it. Folded while one of its pages is open, the group's tile
 * wears the lime. Its pages are ordinary links, so they keep their addresses and their names.
 */
function RailGroup({ item, screen, go }: { item: Extract<RailItem, { kind: 'group' }>; screen: Screen; go: (s: Screen) => void }) {
  const [open, setOpen] = useState(settingsOpen)
  const inside = groupOf(screen) === item.key
  const tile = inside && !open
  const Icon = item.icon
  const toggle = () => {
    if (open) {
      setOpen(false)
      setSettingsOpen(false)
    } else {
      setOpen(true)
      setSettingsOpen(true)
      if (!inside) go(settingsPage())
    }
  }
  return (
    <>
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls={open ? 'rail-settings' : undefined} aria-current={tile ? 'page' : undefined} title={open ? `${item.label} · fold` : item.label} className={ITEM}>
        <span className={tileClass(tile)}>
          <Icon size={20} strokeWidth={tile ? 2.5 : 2} aria-hidden />
        </span>
        <span className={cn('flex items-center gap-0.5', labelClass(tile || (inside && open)))}>
          {item.label}
          <ChevronDown size={10} strokeWidth={3} aria-hidden className={cn('transition-transform', !open && '-rotate-90')} />
        </span>
      </button>
      {open && (
        <div id="rail-settings" role="group" aria-label={item.label} className="flex flex-col items-center gap-1 rounded-lg bg-white/5 px-0.5 py-1">
          {item.pages.map((p) => <RailLink key={p} item={screenDef(p)} active={screen === p} small go={go} />)}
        </div>
      )}
    </>
  )
}

/**
 * The app's navigation on desktop (DESIGN.md §2, after nfl-fantasy's rail): a 72 px dark rail, the household's
 * monogram on top, one icon-over-label tile per screen, the open screen's tile in lime, and the Settings group that
 * folds Household, Data and the Guide. The `dark` class makes the rail a dark scope of its own on the light pages.
 * Phones get the bottom tabs instead.
 */
export const AppRail = memo(function AppRail({ householdName }: { householdName?: string }) {
  const { screen, go } = useScreen()
  const home: Screen = 'grid'
  return (
    <nav aria-label="Screens" className="dark sticky top-0 hidden h-dvh w-[72px] shrink-0 flex-col items-center gap-3 overflow-y-auto border-r border-sidebar-border bg-sidebar py-3 text-sidebar-foreground md:flex">
      <a
        href={screenHref(home)} onClick={(e) => follow(e, () => go(home))} title={householdName ?? 'Casa Papel'} aria-label="Casa Papel"
        className="mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/5 text-sm font-bold tracking-tight text-white ring-2 ring-primary outline-none focus-visible:ring-ring"
      >
        {monogram(householdName ?? 'Casa Papel')}
      </a>
      {isDemoMode() && (
        <button type="button" onClick={leaveDemoSandbox} title="Back to your own household" className="-mt-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Chip tone="amber">demo</Chip>
        </button>
      )}
      {RAIL.map((it) => (it.kind === 'page'
        ? <RailLink key={it.key} item={screenDef(it.key)} active={screen === it.key} go={go} />
        : <RailGroup key={it.key} item={it} screen={screen} go={go} />))}
    </nav>
  )
})
