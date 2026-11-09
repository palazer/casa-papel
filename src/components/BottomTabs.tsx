import { memo } from 'react'
import { RAIL, groupOf, screenDef, screenHref, settingsPage, useScreen, type Screen } from '@/app/screens'
import { follow, labelClass, tileClass } from './railStyles'

/** The phone's navigation (DESIGN.md §2): the rail's four tiles as a dark bar along the bottom edge, above the home
 *  indicator. The Settings tab opens the group's page open last; its pages switch through the tab row under the page
 *  header. Hidden from 768 px, where the rail takes over. */
export const BottomTabs = memo(function BottomTabs() {
  const { screen, go } = useScreen()
  return (
    <nav aria-label="Screens" className="dark fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:hidden">
      {RAIL.map((it) => {
        const target: Screen = it.kind === 'page' ? it.key : settingsPage()
        const active = it.kind === 'page' ? screen === it.key : groupOf(screen) === it.key
        const def = it.kind === 'page' ? screenDef(it.key) : { label: it.label, icon: it.icon }
        const Icon = def.icon
        return (
          <a
            key={it.key} href={screenHref(target)} onClick={(e) => follow(e, () => go(target))} aria-current={active ? 'page' : undefined}
            className="group flex h-14 min-w-16 flex-1 flex-col items-center justify-center gap-0.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className={tileClass(active, 'tabs')}>
              <Icon size={20} strokeWidth={active ? 2.5 : 2} aria-hidden />
            </span>
            <span className={labelClass(active)}>{def.label}</span>
          </a>
        )
      })}
    </nav>
  )
})
