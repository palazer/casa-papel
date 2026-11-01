import { useLiveQuery } from 'dexie-react-hooks'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useStore } from '@/app/store'
import { loadDemo } from '@/demo/loadDemo'

export function HomeScreen({ onOpenData }: { onOpenData: () => void }) {
  const store = useStore()
  const household = useLiveQuery(() => store.db.household.toArray(), [store])
  const counts = useLiveQuery(
    async () => ({
      rows: await store.db.rows.count(),
      cells: await store.db.cells.count(),
      recurring: await store.db.recurringItems.count(),
      accounts: await store.db.accounts.count(),
    }),
    [store],
  )

  if (household === undefined) return null

  if (household.length === 0) {
    return (
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Welcome to Casa Papel</CardTitle>
          <CardDescription>
            Your household budget as a month-by-month grid that knows what a household is. Everything stays on this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={() => void loadDemo(store)}>Load the demo household</Button>
          <Button variant="outline" onClick={onOpenData}>Import a file</Button>
        </CardContent>
      </Card>
    )
  }

  const h = household[0]
  return (
    <div className="space-y-4">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{h.name}</CardTitle>
          <CardDescription>
            {h.baseCurrency} · {h.locale} · from {h.startMonth} · {h.moneyMode} · {h.closingRule}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {counts && (
            <p>
              {counts.rows} rows · {counts.cells} filled cells · {counts.recurring} recurring items · {counts.accounts} accounts
            </p>
          )}
          <p className="mt-2">The grid arrives in Wave 1a. For now you can export, import and inspect your data.</p>
        </CardContent>
      </Card>
    </div>
  )
}
