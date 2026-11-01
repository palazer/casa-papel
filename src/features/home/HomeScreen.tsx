import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useStore } from '@/app/store'
import { loadDemo } from '@/demo/loadDemo'
import { QuickCreate } from './QuickCreate'

export function HomeScreen({ onOpenData, onCreated }: { onOpenData: () => void; onCreated: () => void }) {
  const store = useStore()
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="max-w-xl">
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
      <QuickCreate onCreated={onCreated} />
    </div>
  )
}
