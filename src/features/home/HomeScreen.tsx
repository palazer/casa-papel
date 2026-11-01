import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useStore } from '@/app/store'
import { loadDemo } from '@/demo/loadDemo'
import { SetupWizard } from '@/features/setup/SetupWizard'

export function HomeScreen({ onOpenData, onCreated }: { onOpenData: () => void; onCreated: () => void }) {
  const store = useStore()
  return (
    <div className="space-y-4">
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle>Welcome to Casa Papel</CardTitle>
          <CardDescription>
            Your household budget as a month-by-month grid that knows what a household is. Everything stays on this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void loadDemo(store)}>Load the demo household</Button>
          <Button variant="outline" onClick={onOpenData}>Import a file</Button>
        </CardContent>
      </Card>
      <SetupWizard onCreated={onCreated} />
    </div>
  )
}
