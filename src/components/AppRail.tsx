import { memo } from 'react'
import { isDemoMode } from '@/app/store'
import { SCREENS, screenHref, useScreen, type Screen, type ScreenDef } from '@/app/screens'
import { Chip } from '@/components/ui/chip'
import { follow, labelClass, monogram, tileClass } from './railStyles'

const ITEM = 'group flex w-16 flex-col items-center gap-0.5 rounded-lg py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring'

const RailLink = memo(function RailLink({ item, active, go }: { item: ScreenDef; active: boolean; go: (s: Screen) => void }) {
  const Icon = item.icon
  return (
    <a href={screenHref(item.key)} onClick={(e) => follow(e, () => go(item.key))} aria-current={active ? 'page' : undefined} title={item.label} className={ITEM}>
      <span className={tileClass(active)}>
        <Icon size={20} strokeWidth={active ? 2.5 : 2} aria-hidden />
      </span>
      <span className={labelClass(active)}>{item.label}</span>
    </a>
  )
})

/**
 * The app's navigation on desktop (DESIGN.md §2, after nfl-fantasy's rail): a 72 px dark rail, the household's
 * monogram on top, one icon-over-label tile per screen, the open screen's tile in lime. The `dark` class makes the
 * rail a dark scope of its own on the light pages. Phones get the bottom tabs instead.
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
      {isDemoMode() && <Chip tone="amber" className="-mt-2">demo</Chip>}
      {SCREENS.map((it) => (
        <RailLink key={it.key} item={it} active={screen === it.key} go={go} />
      ))}
    </nav>
  )
})
