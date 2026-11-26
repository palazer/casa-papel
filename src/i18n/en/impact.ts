/**
 * What removing, archiving or restoring something would do, in whole sentences (`src/store/impact.ts`). The dialog
 * shows them as a list before the button is pressed. Names are the household's own and are passed in, as lists where
 * there can be several; `at`, `last` and `span` are months, already written out.
 */

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
const pick = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/** `"A"`, `"A" and "B"`, `"A", "B", "C" and "D"`, `"A", "B", "C", "D" and 2 more`. */
function quoteNames(names: string[], max = 4): string {
  const q = names.map((n) => `"${n}"`)
  if (q.length <= 1) return q[0] ?? ''
  if (q.length <= max) return `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`
  return `${q.slice(0, max).join(', ')} and ${q.length - max} more`
}

const goalsNamed = (goals: string[]): string => `The ${pick(goals.length, 'goal', 'goals')} ${quoteNames(goals)}`
const schedulesNamed = (names: string[]): string => `Its ${pick(names.length, 'schedule', `${names.length} schedules`)} ${quoteNames(names)}`
/** Where spending comes out of once its virtual account is gone: the account that held it, or the month's income. */
const instead = (holder: string | null): string => (holder == null ? 'the month\'s income' : `"${holder}"`)

export const impact = {
  quoteNames,
  /** What kind of thing it is, as the dialog's title says it. A person or thing is named by its own kind. */
  kind: { row: 'Row', account: 'Account', pool: 'Virtual account', schedule: 'Schedule', goal: 'Goal', category: 'Category' },
  gone: {
    row: 'That row no longer exists.', account: 'That account no longer exists.', pool: 'That virtual account no longer exists.',
    entity: 'That person or thing no longer exists.', schedule: 'That schedule no longer exists.', goal: 'That goal no longer exists.', category: 'That category no longer exists.',
  },
  /** Months that are over and change too. A row and a schedule count their months in the line above ("these"). */
  over: (n: number, counted: boolean, span: string) => `${n} of ${counted ? 'these' : 'its'} months ${pick(n, 'is', 'are')} over (${span}): ${pick(n, 'it changes', 'they change')} too`,
  archiveNotBefore: (month: string) => `Archive from ${month} or later, the household's first month.`,
  resolveFirst: (blockers: string[]) => `Resolve this first: ${blockers.join('; ')}.`,
  /** `kind` is the kind of thing in lower case. */
  cannotArchiveDelete: (kind: string) => `A ${kind} cannot be archived. Delete it instead.`,
  cannotArchive: (kind: string) => `A ${kind} cannot be archived.`,
  neverArchived: (kind: string) => `A ${kind} is never archived; there is nothing to restore.`,

  row: {
    losesAmounts: (months: number, span: string) => `Its amounts in ${plural(months, 'month')} (${span})`,
    losesSchedules: (names: string[]) => schedulesNamed(names),
    followersKeepOwn: (names: string[]) => `${quoteNames(names)} ${pick(names.length, 'stops following it and keeps its', 'stop following it and keep their')} own amounts`,
    deductionsOrdinary: (names: string[]) => `${quoteNames(names)} ${pick(names.length, 'is', 'are')} no longer deducted from it and ${pick(names.length, 'counts', 'count')} as ordinary spending`,
    sharersGetNothing: (names: string[]) => `${quoteNames(names)} ${pick(names.length, 'takes a percentage of it and gets', 'take a percentage of it and get')} nothing until another rule is picked`,
    poolNotFilled: (pool: string) => `The virtual account "${pool}" is no longer filled each month`,
    noLeftover: (account: string) => `"${account}" no longer receives the month's leftover`,
    archive: {
      hidden: (at: string, laterMonths: number) => (laterMonths ? `Hidden from ${at} on; its amounts in ${plural(laterMonths, 'later month')} no longer count` : `Hidden from ${at} on`),
      schedulesStop: (names: string[], after: string) => `${schedulesNamed(names)} ${pick(names.length, 'stops', 'stop')} after ${after}`,
      followersKeepLast: (names: string[], at: string) => `${quoteNames(names)} ${pick(names.length, 'stops following it and keeps', 'stop following it and keep')} the last amount as ${pick(names.length, 'its', 'their')} own from ${at}`,
      deductionsOrdinary: (names: string[], at: string) => `${quoteNames(names)} ${pick(names.length, 'is', 'are')} no longer deducted from it and ${pick(names.length, 'counts', 'count')} as ordinary spending from ${at}`,
      sharersGetNothing: (names: string[], at: string) => `${quoteNames(names)} ${pick(names.length, 'takes a percentage of it and gets', 'take a percentage of it and get')} nothing from ${at}, until another rule is picked`,
      poolNotFilled: (pool: string, at: string) => `The virtual account "${pool}" is no longer filled from ${at}`,
      noLeftover: (account: string, at: string) => `"${account}" no longer receives the month's leftover from ${at}`,
    },
  },

  /** Goals that watch an account or a virtual account. */
  losesGoals: (goals: string[]) => `${goalsNamed(goals)}, which ${pick(goals.length, 'watches', 'watch')} it`,
  goalsUnmeasured: (goals: string[]) => `${goalsNamed(goals)} can no longer be measured`,

  account: {
    losesRealBalances: (n: number, span: string) => `${plural(n, 'real balance')} you entered (${span})`,
    /** What stands in the way of deleting it, and where to put that right. */
    blocker: {
      sends: (row: string) => `"${row}" sends money to it`,
      takes: (row: string) => `"${row}" takes money from it`,
      paysOff: (row: string) => `"${row}" pays it off`,
      uses: (row: string) => `"${row}" uses it`,
      rowWhere: 'Point the row at another account from its row menu on the grid, or archive the row.',
      holdsPool: (pool: string) => `The virtual account "${pool}" is held in it`,
      poolWhere: 'Move it to another savings account under Household → Virtual accounts → Edit, or archive it.',
    },
    /** `paying`: every one of the rows is an expense, which names the account that pays. */
    noLongerNamed: (names: string[], paying: boolean) => `${quoteNames(names)} no longer ${pick(names.length, 'names', 'name')} it${paying ? ' as the paying account' : ''}`,
    schedulesNoLongerName: (n: number) => `${plural(n, 'schedule')} no longer ${pick(n, 'names', 'name')} it`,
    fundedFromIncome: (names: string[]) => `${quoteNames(names)} ${pick(names.length, 'comes', 'come')} out of the month's income instead`,
    paidFromIncome: (months: number) => `What came out of it in ${plural(months, 'month')} counts as spent from that month's income, so the leftover there falls`,
    schedulesFromIncome: (n: number) => `${plural(n, 'schedule')} ${pick(n, 'comes', 'come')} out of the month's income instead`,
    archive: {
      balanceStops: (last: string, at: string) => `Its balance stops at ${last}; from ${at} it is hidden and no longer counts towards net worth`,
      hidden: (at: string) => `Hidden from ${at} on; rows that name it keep working`,
      typedKeepMoving: (names: string[], at: string) => `${quoteNames(names)} ${pick(names.length, 'keeps', 'keep')} moving money, but the balance is no longer tracked from ${at}`,
      poolsArchived: (names: string[], at: string) => `Its virtual ${pick(names.length, 'account', 'accounts')} ${quoteNames(names)} ${pick(names.length, 'is', 'are')} archived with it from ${at}`,
      moversFromIncome: (names: string[], at: string) => `From ${at}, ${quoteNames(names)} ${pick(names.length, 'comes', 'come')} out of the month's income; earlier months keep the account as their source`,
    },
  },

  /** `holder` is the account the virtual account is held in when what came out of it goes there, else null. */
  pool: {
    losesBalance: (span: string | null) => `Its balance${span ? ` (${span})` : ''}`,
    losesRow: (row: string, months: number) => `The row "${row}" that fills it${months ? `, with its amounts in ${plural(months, 'month')}` : ''}`,
    fundedInstead: (names: string[], holder: string | null) => `${quoteNames(names)} ${pick(names.length, 'comes', 'come')} out of ${instead(holder)} instead`,
    spendingInstead: (months: number, holder: string | null) => `Spending that came out of it in ${plural(months, 'month')} counts as spent from ${instead(holder)}`,
    schedulesInstead: (n: number, holder: string | null) => `${plural(n, 'schedule')} ${pick(n, 'comes', 'come')} out of ${instead(holder)} instead`,
    archive: {
      balanceStops: (last: string) => `Its balance stops at ${last}`,
      rowArchived: (row: string, at: string) => `"${row}" is archived from ${at}; nothing more is set aside`,
      moversInstead: (names: string[], at: string, holder: string | null) => `From ${at}, ${quoteNames(names)} ${pick(names.length, 'comes', 'come')} out of ${instead(holder)}; earlier months keep the virtual account as their source`,
    },
  },

  entity: {
    rowsBecomeShared: (names: string[]) => `${quoteNames(names)} ${pick(names.length, 'becomes', 'become')} shared`,
    rowsLoseTag: (names: string[]) => `${quoteNames(names)} ${pick(names.length, 'loses its tag', 'lose their tag')}`,
    accountsBecomeHousehold: (names: string[]) => `${quoteNames(names)} ${pick(names.length, 'becomes', 'become')} a household account`,
    methodsBecomeHousehold: (names: string[]) => `The payment ${pick(names.length, 'method', 'methods')} ${quoteNames(names)} ${pick(names.length, 'becomes', 'become')} the household's`,
    schedulesBecomeShared: (n: number) => `${plural(n, 'schedule')} ${pick(n, 'becomes', 'become')} shared`,
    archiveHidden: (at: string) => `Hidden from People & things from ${at}; its rows and earlier months stay as they are`,
  },

  schedule: {
    losesPosted: (months: number, span: string) => `Its posted amount in ${plural(months, 'month')} (${span}); what was already paid stays`,
    note: (posted: boolean) => `${posted ? 'Nothing more is posted.' : 'Nothing more is posted; what was already paid stays.'} To stop it from a month on instead, use "End after" in the schedules list.`,
  },
  goalNote: 'What it watched is not touched.',
  category: {
    losesEstimate: 'its estimate, in every month',
    rowsKeepPlace: (names: string[]) => `${quoteNames(names)} ${pick(names.length, 'keeps its', 'keep their')} place without a category`,
  },

  /** After a restore: what came back, as short clauses joined into one sentence, and what stayed, as whole sentences. */
  restore: {
    restored: (subject: string, back: string[]) => `Restored "${subject}"${back.length ? `: ${back.join('; ')}` : ''}.`,
    noMemo: (name: string) => `"${name}" was archived before the app kept track of what archiving changes, so only "${name}" itself is back.`,
    /** `source` is the name of the virtual account or account the amounts came out of, null for the thing itself. */
    sourceStays: (source: string | null, gone: boolean) => `What came out of ${source == null ? 'it' : `"${source}"`} stays where the archive moved it: ${gone ? 'that no longer exists' : 'that is still archived'}.`,
    rowsComeOutAgain: (names: string[], source: string | null) => `${quoteNames(names)} ${pick(names.length, 'comes', 'come')} out of ${source == null ? 'it' : `"${source}"`} again`,
    restComesOutAgain: (source: string | null) => `what came out of ${source == null ? 'it' : `"${source}"`} comes out of it again`,
    /** `row` is null for the restored row itself ("its schedule … runs again"), else the row that came back with it. */
    schedulesRun: (names: string[], row: string | null) => `${row == null ? 'its' : `"${row}" has its`} ${pick(names.length, 'schedule', 'schedules')} ${quoteNames(names)} ${row == null ? pick(names.length, 'runs', 'run') : 'running'} again`,
    followAgain: (names: string[], row: string | null) => `${quoteNames(names)} ${pick(names.length, 'follows', 'follow')} ${row == null ? 'it' : `"${row}"`} again`,
    fillAgain: (names: string[]) => `${quoteNames(names)} ${pick(names.length, 'fills', 'fill')} it again`,
    poolsBack: (pools: string[], fills: string[]) => `its virtual ${pick(pools.length, 'account', 'accounts')} ${quoteNames(pools)} ${pick(pools.length, 'is', 'are')} back${fills.length ? `, filled by ${quoteNames(fills)} again` : ''}`,
    changedSince: (n: number) => `${plural(n, 'thing')} you changed since ${pick(n, 'stays as it is', 'stay as they are')}.`,
    rowFillsArchivedPool: (row: string, pool: string) => `"${row}" fills the virtual account "${pool}", which is archived. Restore the virtual account: its row comes back with it.`,
    poolHeldInArchivedAccount: (pool: string, account: string) => `"${pool}" is held in "${account}", which is archived. Restore the account first.`,
  },
}
