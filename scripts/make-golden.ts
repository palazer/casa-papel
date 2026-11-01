/**
 * Extract a raw golden fixture from a home-accounting workbook.
 *
 *   node scripts/make-golden.ts private/home-accounting-v2.xlsx tests/engine/golden/v2-raw.json --public
 *   node scripts/make-golden.ts private/home-accounting-v1.xlsx tests/private/v1-raw.json
 *
 * The fixture holds, per sheet, the cached values Excel/Numbers computed, plus
 * formula text, so engine tests can compare against the spreadsheet's own
 * numbers. `--public` neutralises personal labels before writing.
 */
import ExcelJS from 'exceljs'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

type CellOut = { v: number | string | boolean | null; f?: string }
type FlowRow = { r: number; a: CellOut; b: CellOut; label: string | null; cells: (CellOut | null)[] }

const [, , src, out, ...flags] = process.argv
if (!src || !out) {
  console.error('usage: node scripts/make-golden.ts <workbook.xlsx> <out.json> [--public]')
  process.exit(1)
}
const isPublic = flags.includes('--public')

const PUBLIC_LABELS: Array<[RegExp, string]> = [
  [/Firat/g, 'Adult A'],
  [/Buke/g, 'Adult B'],
  [/GiantSteps/g, 'Company'],
]

function neutralise(s: string): string {
  if (!isPublic) return s
  return PUBLIC_LABELS.reduce((acc, [re, to]) => acc.replace(re, to), s)
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function toMonthKey(v: unknown): string | null {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`
  if (typeof v === 'string') {
    const m = /^([A-Za-z]+)\s+(\d{4})$/.exec(v.trim())
    if (m) {
      const idx = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
      if (idx >= 0) return `${m[2]}-${String(idx + 1).padStart(2, '0')}`
    }
  }
  return null
}

function readCell(cell: ExcelJS.Cell): CellOut | null {
  const v = cell.value
  if (v === null || v === undefined) return null
  if (typeof v === 'object') {
    if (v instanceof Date) return { v: v.toISOString().slice(0, 10) }
    if ('result' in v || 'formula' in v || 'sharedFormula' in v) {
      const fv = v as ExcelJS.CellFormulaValue & ExcelJS.CellSharedFormulaValue
      const result = fv.result
      const f = fv.formula ?? (fv.sharedFormula ? `shared:${fv.sharedFormula}` : undefined)
      const r = result instanceof Date ? result.toISOString().slice(0, 10) : (result as number | string | boolean | undefined)
      // exceljs drops cached zero results; every formula in these workbooks was calculated, so no result means 0
      return { v: r ?? 0, f }
    }
    if ('richText' in v) return { v: (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join('') }
    if ('error' in v) return { v: null, f: `error:${(v as ExcelJS.CellErrorValue).error}` }
    return { v: String(v) }
  }
  if (typeof v === 'string') return { v: neutralise(v) }
  return { v: v as number | boolean }
}

function flowSheet(ws: ExcelJS.Worksheet) {
  const months: string[] = []
  const monthCols: number[] = []
  const header = ws.getRow(1)
  for (let c = 4; c <= ws.columnCount; c++) {
    const cell = readCell(header.getCell(c))
    const mk = cell ? toMonthKey(cell.v instanceof Date ? cell.v : typeof cell.v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cell.v) ? new Date(cell.v) : cell.v) : null
    if (mk) {
      months.push(mk)
      monthCols.push(c)
    }
  }
  const rows: FlowRow[] = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const a = readCell(row.getCell(1)) ?? { v: null }
    const b = readCell(row.getCell(2)) ?? { v: null }
    const labelCell = readCell(row.getCell(3))
    const label = labelCell && labelCell.v != null ? String(labelCell.v) : null
    const cells = monthCols.map((c) => readCell(row.getCell(c)))
    if (label === null && cells.every((x) => x === null) && a.v === null && b.v === null) continue
    rows.push({ r, a, b, label, cells })
  }
  return { months, rows, hiddenRows: hiddenRows(ws) }
}

function hiddenRows(ws: ExcelJS.Worksheet): number[] {
  const out: number[] = []
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    if (row.hidden) out.push(n)
  })
  return out
}

function gridSheet(ws: ExcelJS.Worksheet) {
  const grid: Record<string, CellOut> = {}
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = readCell(cell)
      if (v) grid[cell.address] = v
    })
  })
  return grid
}

async function main() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(src)
  const sheets: Record<string, unknown> = {}
  for (const ws of wb.worksheets) {
    if (ws.name === 'Export Summary') continue
    sheets[ws.name] = ws.name === 'Flow' ? flowSheet(ws) : gridSheet(ws)
  }
  const fixture = {
    source: path.basename(src),
    extractedAt: new Date().toISOString().slice(0, 10),
    public: isPublic,
    sheets,
  }
  mkdirSync(path.dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(fixture, null, 1) + '\n')
  const flow = sheets.Flow as ReturnType<typeof flowSheet>
  console.log(`${out}: ${Object.keys(sheets).length} sheets, Flow ${flow.months.length} months × ${flow.rows.length} rows, hidden rows ${flow.hiddenRows.join(',') || 'none'}`)
  const show = (label: string) => {
    const row = flow.rows.find((x) => x.label === label)
    if (row) console.log(`  ${label}: first=${JSON.stringify(row.cells[0])} last=${JSON.stringify(row.cells[row.cells.length - 1])}`)
  }
  for (const l of ['Net Worth', 'To Savings', 'USD/TRY (monthly drift % in col A)', 'Saving Account', 'VALUE', 'Capital']) show(l)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
