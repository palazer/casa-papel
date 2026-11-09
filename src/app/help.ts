import type { AccountType, Household } from '@/model'

/**
 * Every explanation the app shows behind an (i) icon, in one place (DESIGN.md §8). Plain words, sentence case, two or
 * three sentences at most; the title repeats the label the icon sits next to. Texts that belong to a model enum
 * (section blurbs, account types, entity kinds, goal kinds) stay in `src/model/templates.ts`.
 */
export interface HelpText {
  title: string
  text: string
}

export const HELP = {
  // Sections and the rows the app works out itself
  'section.income': { title: 'Income', text: 'What arrives during the month: salaries, benefits, anything else that comes in. Income rows marked "counts for the split" also set each adult\'s share when contributions are proportional.' },
  'section.expense': { title: 'Expenses', text: 'What leaves and does not come back. Each expense can come out of this month\'s income, the savings balance or a pool account.' },
  'section.transfer': { title: 'Transfers', text: 'Money that moves from one of your accounts to another, or into a person\'s pocket. Not spending, so it never counts as an expense; it shows up as a balance instead.' },
  'derived.incomeTotal': { title: 'Income total', text: 'All income rows of the month added up, in your base currency. Rows in another currency are converted at that month\'s rate.' },
  'derived.expensesTotal': { title: 'Expenses total', text: 'All spending of the month, whatever it comes out of. The line below shows how much of it came from savings or pool accounts and so did not touch the month\'s leftover.' },
  'derived.fromSavings': { title: 'From savings and pool accounts', text: 'Spending that was paid from the savings balance or a pool account instead of this month\'s income. It is in the expenses total but not taken from the leftover.' },
  'derived.keptInAccount': { title: 'Kept in account', text: 'With the savings-plug rule the month\'s leftover goes to savings and this is what stays behind: the cash buffer you set under Household.' },
  'derived.leftover': { title: 'Leftover', text: 'Income minus spending from income minus the transfers you typed. What is neither spent nor moved; positive means money stays in the account, negative means the month overran.' },
  'derived.netWorth': { title: 'Net worth', text: 'Every tracked balance added up: savings, investments and other assets minus cards and loans, in your base currency. Only accounts with a tracked balance count.' },

  // Rows
  'row.toSavingsPlug': { title: 'To savings', text: 'Worked out for you: income minus spending from income minus pocket money and the cash buffer. Whatever is left moves to savings, so you never type it.' },
  'row.pocketShare': { title: 'Pocket money', text: 'Each adult\'s share of the pocket money set under Household, paid out of the pooled income. Change the amount there, not here.' },
  'row.follows': { title: 'Follows another row', text: 'This row copies another row\'s amount every month, or a share of it, like a child\'s savings following the child benefit or a tax taking a quarter of a salary. Edit the row it follows; this one has no amount of its own.' },
  'row.followShare': { title: 'Share of the followed row', text: 'The row shows this percentage of the row it follows, month by month. 100 mirrors it exactly; 25 puts a quarter of it here, like a tax that takes a fixed slice of a salary.' },
  'row.deductedFrom': { title: 'Deducted from an income', text: 'A tax or contribution taken off an income before it reaches you. It stays an expense in its own row, the income shows what is left as a net line, and when costs are split in proportion each adult\'s share uses the net amount.' },
  'row.belongsTo': { title: 'Belongs to', text: 'Who the row is for. An adult\'s own row is theirs alone; a row for a child, pet or thing goes to whoever pays for them; a shared row is split between the adults. Moves uses this to work out who sends what where.' },
  'row.inShareBasis': { title: 'Counts for the split', text: 'Ticked, this income sets its adult\'s share of the shared costs when shares come from salaries. Leave it off for child benefit or one-off income that should not move the split.' },
  'row.category': { title: 'Category', text: 'A named group inside the section, like Housing or Transport. Rows sort by category in the grid and share a faint band, so related lines sit together. Categories are managed under Household.' },
  'row.automatic': { title: 'Automatic', text: 'The app works this amount out from the rest of the month, so there is nothing to type. Tick it once the money has actually moved; the amount keeps following the plan.' },
  'row.currency': { title: 'Currency of this row', text: 'Amounts in this row are typed in this currency and shown in the household currency beneath, converted at each month\'s rate. Numbers already typed keep their digits and are read in the new currency; the rates live under Household.' },
  'month.progress': { title: 'Progress', text: 'Every line with an amount counts once; an itemized line counts each item. Still to pay adds up the open spending and transfers, to come in the open income, both in your base currency.' },

  // Balances
  'balance.savings': { title: 'Savings balance', text: 'Last month\'s balance plus what went in minus what came out, month by month from the opening balance. Click a month to enter what the account really held; later months start from your number.' },
  'balance.investmentValue': { title: 'Investment value', text: 'What the account is worth: deposits plus growth at the yearly rate you set, or at the average of the real returns you entered. Click a month to pin the real value.' },
  'balance.deposited': { title: 'Deposited', text: 'The money you have put in so far, without any growth. The difference to the value above is the return.' },
  'balance.return': { title: 'Return', text: 'Total growth so far as a share of what was deposited. Negative when the value fell below the deposits.' },
  'balance.cardOwed': { title: 'Owed on the card', text: 'What is on the card at month end: last month\'s amount plus purchases on the card minus the payment. Depends on how you record card spending in the account\'s settings.' },
  'balance.loanOutstanding': { title: 'Loan outstanding', text: 'What is still owed. Each instalment brings it down; interest is not modelled, so enter the real balance now and then to keep it honest.' },
  'balance.otherAsset': { title: 'Other asset', text: 'Something you own with a value, like a rental deposit. The balance only changes when you enter a new value; it counts towards net worth.' },
  'balance.pool': { title: 'Pool account', text: 'Money set aside inside a savings account for one purpose: what goes in every month minus the spending that comes out of it. The savings balance already includes it.' },
  'balance.inBase': { title: 'In the household currency', text: 'The balance converted at the month\'s rate, so it can be compared with the other balances and counted in net worth. The line above is in the account\'s own currency.' },

  // Stats on Month and Moves
  'stat.toSavings': { title: 'To savings', text: 'How much the month moves into savings, pool accounts included. Negative means the month draws on savings instead.' },
  'stat.movesLeft': { title: 'Moves left', text: 'Transfers and payments of this month that are not ticked as done yet. Tick them here or on the Month screen.' },

  // The cell editor
  'cell.howSure': { title: 'How sure', text: 'An estimate is a guess (italic, dashed underline). Certain means you know the amount. Done means the money has moved; done cells get a green dot and count towards the month\'s progress.' },
  'cell.appliesTo': { title: 'Applies to', text: '"This month and onwards" changes this month and every later month that still follows this row. "Only this month" changes one month; the next month keeps the old amount. Done in a December, it pins January, so the grid shows the next year.' },
  'cell.comesOutOf': { title: 'Comes out of', text: 'The budget side of an expense: this month\'s income (the normal case), the savings balance, or a pool account. Savings and pool accounts do not reduce this month\'s leftover.' },
  'cell.deductions': { title: 'Deducted from this income', text: 'Rows marked as deducted from this income, taken off this month\'s amount. The net is what actually arrives; the deductions stay as expenses in their own rows.' },
  'cell.rate': { title: 'This month\'s rate', text: 'How this amount becomes the household currency. An ECB rate is the European Central Bank\'s for the day the Month rate setting under Household picks, the first business day by default. A manual rate is yours and applies to every row in that currency that month. Projected and carried rates are estimates.' },

  // Household settings
  'household.closingRule': { title: 'Month-end rule', text: 'What happens to the money left at the end of the month. Savings plug: the leftover moves to savings automatically and you never type "To savings". Leftover plug: you type what goes to savings and the rest is shown as leftover.' },
  'household.moneyMode': { title: 'How you share money', text: 'Pooled: all income is household money and each adult gets pocket money. Proportional: each adult pays a share of the shared costs in proportion to their income, and Moves shows who sends what where.' },
  'household.shareBasis': { title: 'What the split is based on', text: 'Salaries only: rows marked "counts for the split" set each adult\'s share. All income: everything each adult brings in. Manual: you set the percentages yourself.' },
  'household.pocketScope': { title: 'Where changes apply', text: 'Pocket money and the cash buffer can change from this month on, leaving earlier months as they were, for this month only, or for every open month at once. Closed months never change.' },
  'household.pocket': { title: 'Pocket money', text: 'The amount all adults together take for themselves every month, out of the pooled income. The grid shows one pocket money row per adult with their share.' },
  'household.buffer': { title: 'Cash kept in the account', text: 'With the savings-plug rule, this much stays in the current account at month end instead of going to savings.' },
  'household.tracked': { title: 'Tracked balance', text: 'A tracked account gets a running balance in the grid, month by month, and counts towards net worth. Untick it for an account you only name, like one that just receives a transfer.' },
  'household.categories': { title: 'Categories', text: 'Named groups inside a section. Rows sort by category in the grid and share a faint band; a label line names each group. Rename, reorder or remove them here; removing a category keeps its rows.' },
  'household.usualCategories': { title: 'The usual categories', text: 'Adds six expense categories most households use: Housing, Living, Transport, Family & pets, Fun, Personal. Rows stay where they are until you assign them.' },
  'household.archived': { title: 'Archived', text: 'Out of the way but not gone: archived rows, accounts, pool accounts, people and things keep their history up to the month they were archived from, and can be restored any time.' },
  'data.export': { title: 'Export file', text: 'One file with every table and the whole change history, so a cleared browser or a new device can take over. Keep it anywhere you like; importing it merges or replaces what is here.' },
  'sync.privacy': { title: 'What leaves this device', text: 'Everything is encrypted on this device before it leaves, and only your password opens it. The server stores the encrypted copy, your email and timestamps. Apart from that, only currency codes and dates ever leave the device, when rates are fetched.' },
  'setup.amount': { title: 'Per month', text: 'Optional: the usual monthly amount. It becomes the first month\'s value and carries forward until you change it in the grid. Leave it empty to type it later.' },
  'setup.owner': { title: 'Belongs to', text: 'Whose account it is. A child\'s account feeds their long-term savings row by default; an adult\'s own account stays theirs when costs are split. The household\'s accounts belong to everyone.' },
  'remove.archiveFrom': { title: 'Archive from', text: 'From this month on the thing is hidden and stops counting. Every earlier month stays exactly as it was, closed months included; that is why anything with amounts in a closed month can only be archived, never deleted.' },

  // Goals and schedules
  'goal.status': { title: 'Goal status', text: 'Measured against the plan in the grid, so the bar moves when the plan changes. On track: reached by the target month. Late: reached after it, or not within the months shown. Reached: already there.' },
  'schedule.status': { title: 'Status this month', text: 'Due: lands in this month and is not ticked yet. Paid: ticked done. Skipped: left out for this month only; the schedule continues. A dash means nothing is due this month.' },
} as const satisfies Record<string, HelpText>

export type HelpKey = keyof typeof HELP

/** The balance text that fits an account, by its type; savings is the default for anything else that is tracked. */
export function balanceHelp(type: AccountType | undefined): HelpKey {
  switch (type) {
    case 'investment': return 'balance.investmentValue'
    case 'credit-card': return 'balance.cardOwed'
    case 'loan': return 'balance.loanOutstanding'
    case 'other-asset': return 'balance.otherAsset'
    default: return 'balance.savings'
  }
}

/** The month-end rule, one line each, for the setting's own help line and the wizard. */
export const RULE_HELP: Record<Household['closingRule'], string> = {
  'savings-plug': 'Income minus spending minus pocket money is moved to savings. You never type "To savings".',
  'leftover-plug': 'You type how much goes to savings. What remains is shown as leftover.',
}

/** How money is shared, one line each. */
export const MODE_HELP: Record<Household['moneyMode'], string> = {
  pooled: 'All income is household money. Each adult gets pocket money to spend freely.',
  proportional: 'Each adult pays a share of the shared costs in proportion to their income. Moves shows who sends what where.',
}

/** What a proportional split is based on, one line each. */
export const BASIS_HELP: Record<Household['shareBasis'], string> = {
  'basis-rows': 'Salaries only. Rows marked "counts for the split" set each adult\'s share; child benefit and one-off income do not.',
  'all-income': 'Everything each adult brings in, including income for the children they pay for.',
  manual: 'You set the percentages yourself.',
}
