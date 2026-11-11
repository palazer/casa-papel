/**
 * One-time helper: turn the v1 workbook's register sheets into a Casa Papel import file.
 *
 *   npx tsx scripts/import-v1-register.ts private/home-accounting-v1.xlsx private/casa-papel-import.json --name "Our household" --start 2026-11 --pocket 1200
 *
 * Import the result from the Data screen (Replace everything). Runs locally only.
 */
import ExcelJS from 'exceljs'
import { writeFileSync } from 'node:fs'
import { mapV1, type JointLine, type RegisterLine, type SavingLine } from './lib/v1Register'

const [, , src, out, ...rest] = process.argv
if (!src || !out) {
  console.error('usage: tsx scripts/import-v1-register.ts <v1.xlsx> <out.json> [--name N] [--start YYYY-MM] [--pocket amount]')
  process.exit(1)
}
const opt = (flag: string, fallback: string) => {
  const i = rest.indexOf(flag)
  return i >= 0 && rest[i + 1] ? rest[i + 1] : fallback
}

const text = (c: ExcelJS.Cell): string => {
  const v = c.value
  if (v == null) return ''
  if (typeof v === 'object' && 'richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('')
  if (typeof v === 'object' && 'result' in v) return String((v as ExcelJS.CellFormulaValue).result ?? '')
  return String(v)
}
const num = (c: ExcelJS.Cell): number => {
  const v = c.value
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && 'result' in v && typeof (v as ExcelJS.CellFormulaValue).result === 'number') return (v as ExcelJS.CellFormulaValue).result as number
  return 0
}

async function main() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(src)
  const expenses: RegisterLine[] = []
  const ex = wb.getWorksheet('Expenses')
  ex?.eachRow((row, n) => {
    if (n < 5) return
    const name = text(row.getCell(4)).trim()
    if (!name) return
    expenses.push({ name, category: text(row.getCell(5)).trim(), amount: num(row.getCell(6)), from: text(row.getCell(7)).trim(), notes: text(row.getCell(8)).trim() })
  })
  const joint: JointLine[] = []
  wb.getWorksheet('Monthly Joint')?.eachRow((row, n) => {
    if (n < 2) return
    const category = text(row.getCell(1)).trim()
    if (!category) return
    joint.push({ category, amount: num(row.getCell(2)), account: text(row.getCell(3)).trim() })
  })
  const savings: SavingLine[] = []
  wb.getWorksheet('Saving & Investments')?.eachRow((row, n) => {
    if (n < 4) return
    const purpose = text(row.getCell(2)).trim()
    if (!purpose) return
    savings.push({ purpose, category: text(row.getCell(3)).trim(), amount: num(row.getCell(4)), account: text(row.getCell(5)).trim(), notes: text(row.getCell(6)).trim() })
  })
  const file = mapV1({
    householdName: opt('--name', 'Our household'), startMonth: opt('--start', new Date().toISOString().slice(0, 7)),
    pocketTotal: Number(opt('--pocket', '0')), expenses, joint, savings,
  })
  writeFileSync(out, JSON.stringify(file, null, 1) + '\n')
  const t = file.tables
  console.log(`${out}: ${t.entities.length} entities, ${t.accounts.length} accounts, ${t.rows.length} rows, ${t.recurringItems.length} schedules, ${t.pools.length} virtual accounts`)
  console.log('entities:', t.entities.map((e) => `${e.kind}:${e.name}`).join(', '))
  console.log('accounts:', t.accounts.map((a) => `${a.name} [${a.type}]`).join(', '))
  console.log('rows:', t.rows.map((r) => r.name).join(' | '))
  const nonMonthly = t.recurringItems.filter((i) => i.cadence && i.cadence.intervalMonths !== 1)
  console.log('non-monthly items:', nonMonthly.map((i) => `${i.name} every ${i.cadence!.intervalMonths}m from ${i.cadence!.anchorMonth} = ${i.amount / 100} ${i.currency ?? 'EUR'}`).join('; '))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
