import { addRow, addRowOfKind, setCellValue } from '@/store'
import type { Row } from '@/model'
import { step } from '../registry'
import { ScenarioError, type World } from '../world'

/**
 * A new row and its first amount, the way the Statement does it: "Add row", then the amount typed into the row's
 * dialog with "Repeats: every month". A currency other than the household's is chosen in that same dialog.
 */
async function rowWithAmount(world: World, section: Row['section'], name: string, amount: number, from: string, currency?: string): Promise<void> {
  const row = await addRow(world.store, { name, section, categoryId: null })
  await setCellValue(world.store, row.id, from, amount, 'from-now-on', currency ? { currency } : undefined)
}

step('an income {string} of {money} from {month}', (world: World, name: string, amount: number, from: string) => rowWithAmount(world, 'income', name, amount, from))
step('an income {string} in {ccy} of {money} from {month}', (world: World, name: string, currency: string, amount: number, from: string) => rowWithAmount(world, 'income', name, amount, from, currency))
step('an expense {string} of {money} from {month}', (world: World, name: string, amount: number, from: string) => rowWithAmount(world, 'expense', name, amount, from))
step('an expense {string} in {ccy} of {money} from {month}', (world: World, name: string, currency: string, amount: number, from: string) => rowWithAmount(world, 'expense', name, amount, from, currency))

step('an income {string} with no amount yet', async (world: World, name: string) => {
  await addRow(world.store, { name, section: 'income', categoryId: null })
})
step('an expense {string} with no amount yet', async (world: World, name: string) => {
  await addRow(world.store, { name, section: 'expense', categoryId: null })
})

// "Just moves money between your accounts": a transfer row that names no account
step('a row {string} that moves {money} between my accounts from {month}', (world: World, name: string, amount: number, from: string) => rowWithAmount(world, 'transfer', name, amount, from))

// "Goes to a savings account" or "Goes to an investment account", with the amount typed
step('a transfer {string} of {money} to {string} from {month}', async (world: World, name: string, amount: number, accountName: string, from: string) => {
  const account = await world.account(accountName)
  const kind = account.type === 'savings' ? 'to-savings' : account.type === 'investment' ? 'to-investment' : null
  if (!kind) throw new ScenarioError(`"${accountName}" is not a savings or an investment account, so no transfer row goes to it.`)
  const row = await addRowOfKind(world.store, { section: 'transfer', name, categoryId: null, kind, accountId: account.id })
  await setCellValue(world.store, row.id, from, amount, 'from-now-on')
})
