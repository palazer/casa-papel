import { memo } from 'react'
import { SCREENS, screenHref, useScreen } from '@/app/screens'
import { follow, labelClass, tileClass } from './railStyles'

/** The phone's navigation (DESIGN.md §2): the rail's five tiles as a dark bar along the bottom edge, above the home
 *  indicator. Hidden from 768 px, where the rail takes over. */
export const BottomTabs = memo(function BottomTabs() {
  const { screen, go } = useScreen()
  return (
    <nav aria-label="Screens" className="dark fixed inset-x-0 bottom-0 z-40 flex justify-around border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground md:hidden">
      {SCREENS.map((it) => {
        const active = screen === it.key
        const Icon = it.icon
        return (
          <a
            key={it.key} href={screenHref(it.key)} onClick={(e) => follow(e, () => go(it.key))} aria-current={active ? 'page' : undefined}
            className="group flex h-14 min-w-16 flex-1 flex-col items-center justify-center gap-0.5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className={tileClass(active, 'tabs')}>
              <Icon size={20} strokeWidth={active ? 2.5 : 2} aria-hidden />
            </span>
            <span className={labelClass(active)}>{it.label}</span>
          </a>
        )
      })}
    </nav>
  )
})
