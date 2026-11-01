/** Shape written by scripts/make-golden.ts */
export type RawCell = { v: number | string | boolean | null; f?: string }
export type RawFlowRow = { r: number; a: RawCell; b: RawCell; label: string | null; cells: (RawCell | null)[] }
export type RawFlow = { months: string[]; rows: RawFlowRow[]; hiddenRows: number[] }
export type RawFixture = { source: string; public: boolean; sheets: { Flow: RawFlow } & Record<string, unknown> }

export const num = (c: RawCell | null | undefined): number => (c && typeof c.v === 'number' ? c.v : 0)
export const minor = (v: number): number => Math.round(Math.abs(v) * 100)
/** `=E28` style: a plain reference to the same row in the previous column. */
export const isCarryFormula = (c: RawCell | null | undefined): boolean => !!c?.f && /^[A-Z]{1,3}\d+$/.test(c.f)
export const byRow = (flow: RawFlow) => new Map(flow.rows.map((r) => [r.r, r]))
