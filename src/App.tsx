import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { createAppStore, isDemoMode } from '@/app/store'
import { StoreProvider } from '@/app/StoreProvider'
import { DataScreen } from '@/features/data/DataScreen'
import { HomeScreen } from '@/features/home/HomeScreen'

type Screen = 'home' | 'data'

export default function App() {
  const store = useMemo(() => createAppStore(), [])
  const [screen, setScreen] = useState<Screen>('home')

  return (
    <StoreProvider store={store}>
      <div className="min-h-dvh bg-background text-foreground">
        <header className="border-b">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-7 rounded-md" />
            <span className="font-semibold tracking-tight">Casa Papel</span>
            {isDemoMode() && <Badge variant="secondary">demo</Badge>}
            <nav className="ml-auto flex gap-1">
              <Button variant={screen === 'home' ? 'secondary' : 'ghost'} size="sm" onClick={() => setScreen('home')}>Home</Button>
              <Button variant={screen === 'data' ? 'secondary' : 'ghost'} size="sm" onClick={() => setScreen('data')}>Data</Button>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">
          {screen === 'home' ? <HomeScreen onOpenData={() => setScreen('data')} /> : <DataScreen />}
        </main>
      </div>
    </StoreProvider>
  )
}
