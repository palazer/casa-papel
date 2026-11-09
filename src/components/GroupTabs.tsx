import { SETTINGS_PAGES, groupOf, screenDef, useScreen } from '@/app/screens'
import { TabBar } from '@/components/ui/tab-bar'

/** Phones only (DESIGN.md §2): the Settings group's pages as a tab row under the page header, since the bottom bar
 *  cannot unfold the way the rail does. Renders nothing outside the group. */
export function GroupTabs() {
  const { screen, go } = useScreen()
  if (!groupOf(screen)) return null
  return (
    <div className="border-b md:hidden">
      <TabBar value={screen} options={SETTINGS_PAGES} labels={{ household: screenDef('household').label, data: screenDef('data').label, guide: screenDef('guide').label }} onChange={go} ariaLabel="Settings pages" />
    </div>
  )
}
