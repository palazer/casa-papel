import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useStore } from '@/app/store'
import { monthOfDate, type Household } from '@/model'
import { quickCreateHousehold } from '@/store'
import { NativeSelect } from '@/features/grid/NativeSelect'

const CURRENCIES = ['EUR', 'USD', 'GBP', 'TRY', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'JPY', 'CAD', 'AUD']
const LOCALES = ['en-IE', 'en-GB', 'en-US', 'de-DE', 'de-AT', 'tr-TR', 'fr-FR', 'es-ES', 'nl-NL', 'it-IT', 'pt-PT', 'sv-SE']

export function QuickCreate({ onCreated }: { onCreated: () => void }) {
  const store = useStore()
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [locale, setLocale] = useState(() => (LOCALES.includes(navigator.language) ? navigator.language : 'en-IE'))
  const [startMonth, setStartMonth] = useState(monthOfDate())
  const [rule, setRule] = useState<Household['closingRule']>('savings-plug')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    try {
      await quickCreateHousehold(store, { name: name.trim() || 'Our household', baseCurrency: currency, locale, startMonth, closingRule: rule })
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the household')
    }
  }

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Start your household</CardTitle>
        <CardDescription>Four answers and you have a grid. Everything else can be added as you go.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="hh-name">Household name</Label>
          <Input id="hh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Our household" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="hh-ccy">Currency</Label>
            <NativeSelect id="hh-ccy" className="w-full" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hh-locale">Number format</Label>
            <NativeSelect id="hh-locale" className="w-full" value={locale} onChange={(e) => setLocale(e.target.value)}>
              {LOCALES.map((l) => <option key={l} value={l}>{l}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hh-start">First month</Label>
            <Input id="hh-start" type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hh-rule">Month-end rule</Label>
            <NativeSelect id="hh-rule" className="w-full" value={rule} onChange={(e) => setRule(e.target.value as Household['closingRule'])}>
              <option value="savings-plug">Whatever is left goes to savings</option>
              <option value="leftover-plug">I decide savings, show me what is left</option>
            </NativeSelect>
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={() => void submit()}>Create household</Button>
      </CardContent>
    </Card>
  )
}
