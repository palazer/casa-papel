/** Words the whole app shares: the screens' names, how a rule and a tick read, what an amount field says. */

export const app = {
  /** The screens, as the rail, the phone bar and each page's heading name them. */
  screen: { statement: 'Statement', grid: 'Grid', payments: 'Payments', trends: 'Trends', household: 'Household', data: 'Data', guide: 'Guide' },
  settings: 'Settings',
  /** How much of a cell is ticked. */
  done: { all: 'Done', none: 'Not done yet', some: (done: number, total: number) => `${done} of ${total} done` },
  /** A rule in the rule dialog's words; `share` is a percentage, already written out. */
  rule: {
    shareOfIncome: (share: string) => `${share} of income`,
    shareOfOwnIncome: (share: string) => `${share} of their own income`,
    /** `row` is the income line's name, null when it is gone. */
    shareOfRow: (share: string, row: string | null) => `${share} of ${row ?? 'an income line that is gone'}`,
    shareOfRest: (share: string) => `${share} of what is left`,
    rest: 'the rest',
    idle: 'nothing, another account takes the rest',
    none: 'no rule yet',
    fixed: 'a fixed amount',
  },
  /** A currency in a choice, when it is the household's own. */
  householdCurrency: (code: string) => `${code} (household currency)`,
  /** What a field says when someone tried to multiply or divide in it. */
  onlyPlusMinus: 'Only + and - can be used in an amount.',
  notANumber: 'That is not a number I can read.',
  /** A day of the month as it is said: 1st, 2nd, 3rd, 4th, 11th, 21st, 22nd, 23rd, 31st. */
  ordinalDay: (day: number) => {
    const teen = day % 100 >= 11 && day % 100 <= 13
    const suffix = teen ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th'
    return `${day}${suffix}`
  },
  /** Shown in place of a screen that could not be drawn. */
  broken: {
    title: 'Something broke on this screen',
    text: 'Your data is safe in this browser. Reload the page to continue. If it keeps happening, export your data from the Data screen and report the message below.',
    reload: 'Reload',
  },
}
