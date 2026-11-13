import type { AccountType } from '@/model'

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
  'section.income': { title: 'Income', text: 'What arrives during the month: salaries, benefits, anything else that comes in. An income line that belongs to an adult counts as that adult\'s own income.' },
  'section.expense': { title: 'Expenses', text: 'What leaves and does not come back. Each expense can come out of this month\'s income, the savings balance or a virtual account.' },
  'section.transfer': { title: 'Transfers', text: 'Money that moves from one of your accounts to another, or into a person\'s pocket. Not spending, so it never counts as an expense; it shows up as a balance instead.' },
  'derived.incomeTotal': { title: 'Income total', text: 'All income rows of the month added up, in your base currency. Rows in another currency are converted at that month\'s rate.' },
  'derived.expensesTotal': { title: 'Expenses total', text: 'All spending of the month, whatever it comes out of. The line below shows how much of it came from savings or virtual accounts and so did not touch the month\'s leftover.' },
  'derived.fromSavings': { title: 'From savings and virtual accounts', text: 'Worked out from your expenses, never typed: every expense that comes out of the savings balance or a virtual account shows here instead of being taken from the month\'s income. To change it, change the expense or what it comes out of.' },
  'derived.keptInAccount': { title: 'Kept in account', text: 'With the savings-plug rule the month\'s leftover goes to savings and this is what stays behind: the cash buffer you set under Household.' },
  'derived.leftover': { title: 'Leftover', text: 'Income minus spending from income minus the transfers you typed. What is neither spent nor moved; positive means money stays in the account, negative means the month overran.' },
  'derived.netWorth': { title: 'Net worth', text: 'Everything you have minus everything you owe, in your base currency: savings, investments, other assets and what stays in the main account, minus cards and loans. The current accounts\' part is worked out unless you typed their real balances; the other accounts count when their balance is tracked.' },

  // Rows
  'row.toSavingsPlug': { title: 'To savings', text: 'Worked out for you: income minus spending from income minus pocket money and the cash buffer. Whatever is left moves to savings, so you never type it.' },
  'row.follows': { title: 'Follows another row', text: 'This row copies another row\'s amount every month, or a share of it, like a child\'s savings following the child benefit or a tax taking a quarter of a salary. Edit the row it follows; this one has no amount of its own.' },
  'row.followShare': { title: 'Share of the followed row', text: 'The row shows this percentage of the row it follows, month by month. 100 mirrors it exactly; 25 puts a quarter of it here, like a tax that takes a fixed slice of a salary.' },
  'row.deductedFrom': { title: 'Deducted from an income', text: 'A tax or contribution taken off an income before it reaches you. It stays an expense in its own row, the income shows what is left as a net line, and percentages of income count the net amount.' },
  'row.belongsTo': { title: 'Belongs to', text: 'Who the row is for: the household, an adult, or a child, pet or thing. An adult\'s own rows count for them in "Per person" under the Statement, and their income lines are what a pocket money rule takes a percentage of.' },
  'row.category': { title: 'Category', text: 'A named group inside the section, like Housing or Transport. Rows sort by category in the grid and share a faint band, so related lines sit together. Categories are managed under Household.' },
  'row.rule': { title: 'How the amount is set', text: 'A fixed amount you type, or a rule the app works out each month: a percentage of take-home income, of one income line or of what is left, or the rest. Pocket money never takes the rest; it can be a percentage of its adult\'s own income. Percentages of income come first, then the cash kept, then what is left; one account takes the rest.' },
  'row.ruleFrom': { title: 'Counts from', text: 'A rule counts from this month on. The months before it keep the amounts they showed, so changing a percentage never rewrites the past. Amounts typed for this account from this month on are replaced by the rule.' },
  'row.automatic': { title: 'Automatic', text: 'The app works this amount out from the rest of the month or from a rule, so there is nothing to type. Tick it once the money has actually moved; the amount keeps following the plan.' },
  'row.currency': { title: 'Currency of this row', text: 'Amounts in this row are typed in this currency and shown in the household currency beneath, converted at each month\'s rate. Numbers already typed keep their digits and are read in the new currency; the rates live under Household.' },
  'statement.progress': { title: 'Progress', text: 'Every line with an amount counts once; an itemized line counts each item. Still to pay adds up the open spending and transfers, to come in the open income, both in your base currency. "Close month" locks the month and counts all of it as done.' },

  // Balances
  'balance.savings': { title: 'Savings balance', text: 'Last month\'s balance plus what went in minus what came out, month by month from the opening balance. Click a month to enter what the account really held; later months start from your number.' },
  'balance.investmentValue': { title: 'Investment value', text: 'What the account is worth: deposits plus growth at the yearly rate you set, or at the average of the real returns you entered. Click a month to pin the real value.' },
  'balance.deposited': { title: 'Deposited', text: 'The money you have put in so far, without any growth. The difference to the value above is the return.' },
  'balance.return': { title: 'Return', text: 'Total growth so far as a share of what was deposited. Negative when the value fell below the deposits.' },
  'balance.cardOwed': { title: 'Owed on the card', text: 'What is on the card at month end: last month\'s amount plus purchases on the card minus the payment. Depends on how you record card spending in the account\'s settings.' },
  'balance.loanOutstanding': { title: 'Loan outstanding', text: 'What is still owed. Each instalment brings it down; interest is not modelled, so enter the real balance now and then to keep it honest.' },
  'balance.otherAsset': { title: 'Other asset', text: 'Something you own with a value, like a rental deposit. The balance only changes when you enter a new value; it counts towards net worth.' },
  'balance.pool': { title: 'Virtual account', text: 'Money set aside inside a savings account for one purpose: what goes in every month minus the spending that comes out of it. The savings balance already includes it. It never goes below zero: when more comes out than it holds, the rest comes out of the unassigned savings and the virtual account shows as short until you top it up on the Statement.' },
  'balance.inBase': { title: 'In the household currency', text: 'The balance converted at the month\'s rate, so it can be compared with the other balances and counted in net worth. The line above is in the account\'s own currency.' },

  // The cell editor
  'cell.howSure': { title: 'How sure', text: 'An estimate is a guess; it sits on a light yellow shade. Certain means you know the amount. Done means the money has moved; done amounts get a green dot and count towards the month\'s progress.' },
  'cell.repeats': { title: 'Repeats', text: '"Every month" keeps the amount in every later month until you change it. "On a schedule" lands it only in its months: every 2, 3 or 6 months, every year, or in chosen months; the months between stay empty. "Only this month" changes one month; the next keeps the old amount. Done in a December, it pins January, so the grid shows the next year.' },
  'cell.comesOutOf': { title: 'Comes out of', text: 'The budget side of an expense: this month\'s income (the normal case), the savings balance, or a virtual account. Savings and virtual accounts do not reduce this month\'s leftover.' },
  'cell.deductions': { title: 'Deducted from this income', text: 'Rows marked as deducted from this income, taken off this month\'s amount. The net is what actually arrives; the deductions stay as expenses in their own rows.' },
  'cell.rate': { title: 'This month\'s rate', text: 'How this amount becomes the household currency. An ECB rate is the European Central Bank\'s for the day the Month rate setting under Household picks, the first business day by default. A manual rate is yours and applies to every row in that currency that month. Projected and carried rates are estimates.' },

  'row.categoryEstimate': { title: 'Category estimate', text: 'What you expect a category to come to in a month, before you know every row. Its rows are taken off it and what is left counts as "Not broken down yet"; once the rows add up to more, the category is their sum. Set it on the Statement, inside the category.' },
  // Household settings
  'household.bufferScope': { title: 'Where changes apply', text: 'The cash buffer can change from this month on, leaving earlier months as they were, for this month only, or for every open month at once. Closed months never change.' },
  'household.buffer': { title: 'Cash kept in the account', text: 'With the savings-plug rule, this much stays in the current account at month end instead of going to savings.' },
  'household.tracked': { title: 'Tracked balance', text: 'A tracked account gets a running balance in the grid, month by month, and counts towards net worth. Untick it for an account you only name, like one that just receives a transfer.' },
  'household.categories': { title: 'Categories', text: 'Named groups inside a section. Rows sort by category in the grid and share a faint band; a label line names each group. Rename, reorder or remove them here; removing a category keeps its rows.' },
  'household.usualCategories': { title: 'The usual categories', text: 'Adds six expense categories most households use: Housing, Living, Transport, Family & pets, Fun, Personal. Rows stay where they are until you assign them.' },
  'household.archived': { title: 'Archived', text: 'Out of the way but not gone: archived rows, accounts, virtual accounts, people and things keep their history up to the month they were archived from, and can be restored any time.' },
  'data.export': { title: 'Export file', text: 'One file with every table and the whole change history, so a cleared browser or a new device can take over. Keep it anywhere you like; importing it merges or replaces what is here.' },
  'sync.privacy': { title: 'What leaves this device', text: 'Everything is encrypted on this device before it leaves, and only your password opens it. The server stores the encrypted copy, your email and timestamps. Apart from that, only currency codes and dates ever leave the device, when rates are fetched.' },
  'statement.setup': { title: 'Setting up', text: 'Shown while a household is new. Six steps lead through the page: income, expenses, savings, virtual accounts, investments, loans and cards. The part a step is about is lit; the rest is locked until its step. A number gets a tick once its step is done. "Skip" moves on, a number goes to its step, and "Leave setup" unlocks everything and puts the guide away.' },
  'statement.suggestions': { title: 'Suggestions', text: 'Rows a household like yours usually has, offered where they will appear: for each person and thing, and for the household. Nothing exists until you add it. Type the usual monthly amount and press Enter, or add the row empty. The (i) on a line says what it is for. "×" takes a suggestion away; the undo arrow brings it back.' },
  'setup.owner': { title: 'Owner', text: 'Whose account it is. A child\'s account feeds their long-term savings row by default; an adult\'s own account stays theirs when costs are split. The household\'s accounts belong to everyone.' },
  'remove.archiveFrom': { title: 'Archive from', text: 'From this month on the thing is hidden and stops counting. Every earlier month stays exactly as it was, closed months included; that is why anything with amounts in a closed month can only be archived, never deleted.' },

  // The Statement
  'statement.month': { title: 'The month', text: 'Money in on the left, money out on the right, and the two totals always agree. What is neither spent nor set aside closes the right side as the rest; a month that overruns shows on the left what it took from savings or from the account.' },
  'statement.position': { title: 'At the end of the month', text: 'What you have on the left. On the right, whose it is: debts first, then your net worth, split into what is set aside in virtual accounts and what is free. The change column shows how the month moved each figure.' },
  'statement.setAside': { title: 'To savings, investments and debts', text: 'Money that leaves the main account but stays yours: into savings, investments and virtual accounts, or off a loan or a card. A loan payment is here and not under Expenses because the money is not gone: it brings the debt down (the Grid lists it under Expenses). Press a line to change the amount or how it is set.' },
  'statement.mainAccount': { title: 'Current accounts', text: 'What stays in your current accounts. Worked out: what they started with, plus what each month kept or fell short, plus money waiting for a card bill. Press the amount to type what the bank says: later months continue from it, and the line shows how far the plan was off.' },
  'statement.netWorth': { title: 'Net worth', text: 'Assets minus debts, the same figure on every screen. It counts what stays in the main account, so its change is the month\'s result: income minus spending, plus what investments earned.' },
  'statement.fromAccounts': { title: 'From accounts', text: 'Money that came out of your own accounts this month; each line names the account. "calculated": an expense that comes out of savings or a virtual account, written by the app. "to cover the month": what fills a month that overran. No tag: a row you add yourself, to fill a gap or top up a virtual account. Add a row here and type its amount.' },
  'statement.free': { title: 'Free', text: 'The part of your net worth that no virtual account has set aside. It closes the right side, which is why both sides agree.' },
  'statement.perPerson': { title: 'Per person', text: 'Income minus own spending minus pocket money: what each adult leaves for the household this month. A row counts for an adult when it belongs to them (row menu, "Belongs to…"); rows for children, pets and things are the household\'s.' },

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
