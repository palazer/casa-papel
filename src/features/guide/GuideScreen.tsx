import { Button, buttonVariants } from '@/components/ui/button'
import { Island } from '@/components/ui/island'
import { GroupTabs } from '@/components/GroupTabs'
import { PageHeader } from '@/components/PageHeader'
import { GUIDE_LEAD, REPO_URL } from '@/app/guide'
import { isDemoMode, openDemoSandbox } from '@/app/store'

/** The Guide (DESIGN.md §2): a reading page that opens without a household. The lead says what Casa Papel is; the
 *  topics follow. */
export function GuideScreen() {
  return (
    <div className="space-y-4">
      <PageHeader title="Guide" subline="How Casa Papel works, topic by topic" controls={false} />
      <GroupTabs />
      <div className="mx-auto max-w-3xl space-y-4 text-xs">
        <Island air title={GUIDE_LEAD.title}>
          <div className="space-y-2 text-sm leading-6">
            {GUIDE_LEAD.paragraphs.map((p) => <p key={p.slice(0, 24)}>{p}</p>)}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!isDemoMode() && <Button size="xs" variant="outline" onClick={openDemoSandbox}>Try the demo</Button>}
            <a href={REPO_URL} target="_blank" rel="noreferrer" className={buttonVariants({ size: 'xs', variant: 'ghost' })}>Open on GitHub</a>
          </div>
        </Island>
      </div>
    </div>
  )
}
