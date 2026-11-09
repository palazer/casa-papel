import { ACCOUNT_TYPE_INFO, ENTITY_KIND_HELP, ENTITY_KIND_LABEL, GOAL_KIND_INFO, type EntityKind } from '@/model'
import { BASIS_HELP, MODE_HELP, RULE_HELP, type HelpKey } from './help'
import type { Screen } from './screens'

/**
 * The Guide's words (DESIGN.md §2): one module, no React, so a translation can follow later. Every quoted label is a
 * control's real text; the examples are the demo household's (Sam, Alex, Robin, Biscuit, The car, The flat). Topics
 * that explain a choice carry the model's own option texts as `facts`, so the Guide and the dialogs never disagree.
 */

export const REPO_URL = 'https://github.com/palazer/casa-papel'

export const GUIDE_LEAD = {
  title: 'What Casa Papel is',
  paragraphs: [
    'Casa Papel is local-first household budgeting: your household budget as a month-by-month grid that knows what a household is. Who lives in it, what it owns, what recurs, what is saved for, who pays what. It runs in your browser, on your phone as well as your laptop, and works offline.',
    'Money comes in three kinds, each with its own colour: Income, Expenses and Transfers, with Balances beneath them. You type positive numbers and the section says which way the money goes; the "Show expenses as negative red numbers" setting only changes how spending looks, never how it adds up. Nothing hides behind a formula: every total, balance and automatic row has an (i) that says in a sentence how it was worked out.',
    'Your data stays on your device unless you export it; Casa Papel has no server of its own. Optional cloud sync keeps an encrypted copy that only your password can open, for the same household on several devices. Apart from that, only currency codes and dates ever leave the device, when rates are fetched. To try everything without touching your own numbers, the demo sandbox is a separate store with a made-up household: Sam and Alex, their child Robin, Biscuit the dog, The car and The flat.',
  ],
}

export interface GuideFact {
  label: string
  text: string
}

export interface GuideTopic {
  /** Kebab-case; the section's id is `guide-<key>`. */
  key: string
  title: string
  /** One sentence under the title. */
  summary: string
  /** One to three short paragraphs: what it is and how it behaves. */
  what: string[]
  /** Numbered steps naming the exact controls in quotes. */
  steps: string[]
  /** The model's own option texts, when the topic explains a choice. */
  factsTitle?: string
  facts?: GuideFact[]
  /** The (i) texts that belong to the topic, rendered from `HELP` so the two never disagree. */
  tips: HelpKey[]
  /** The screen the "Open …" button goes to. */
  open: Screen
}

const kinds: GuideFact[] = (Object.keys(ENTITY_KIND_LABEL) as EntityKind[]).map((k) => ({ label: ENTITY_KIND_LABEL[k], text: ENTITY_KIND_HELP[k] }))
const rules: GuideFact[] = [
  { label: 'Leftover goes to savings', text: RULE_HELP['savings-plug'] },
  { label: 'I decide the savings amount', text: RULE_HELP['leftover-plug'] },
]
const sharing: GuideFact[] = [
  { label: 'Pooled, with pocket money', text: MODE_HELP.pooled },
  { label: 'In proportion to income', text: MODE_HELP.proportional },
  { label: 'Shares come from: Salaries', text: BASIS_HELP['basis-rows'] },
  { label: 'Shares come from: All income', text: BASIS_HELP['all-income'] },
  { label: 'Shares come from: Percentages I set', text: BASIS_HELP.manual },
]
const accountTypes: GuideFact[] = ACCOUNT_TYPE_INFO.map((a) => ({ label: a.label, text: a.help }))
const goalKinds: GuideFact[] = GOAL_KIND_INFO.map((g) => ({ label: g.label, text: g.help }))

export const GUIDE: GuideTopic[] = [
  {
    key: 'grid',
    title: 'Start & the grid',
    summary: 'The grid is your plan: months across, rows down, three sections and the balances beneath.',
    what: [
      'Every screen reads the same plan. The Grid shows it whole: one column per month, one row per thing that comes in, goes out or moves, under the sections "Income", "Expenses" and "Transfers", with "Balances" and "Net worth" beneath. An amount carries forward until you change it, so a plan for a year is a handful of entries.',
      'The plan always ends in a December. "Add <year>" in the toolbar grows it by a calendar year, and a change beyond the end grows it by itself. Every change is one undoable step: the two arrows at the left of every toolbar take it back and forward.',
      'The demo sandbox is a separate store with a made-up household, so you can try everything there without touching your own numbers.',
    ],
    steps: [
      'Click a cell, "Groceries" in this month, say; type in "Amount in EUR" and press "Save".',
      'Under "Applies to", keep "This month and onwards" to change this month and every later month that still follows it, or pick "Only this month".',
      'Add a row with "Add row" at the foot of a section: a "Row name", a category when the section has any, then "Add".',
      'Grow the plan with "Add <year>" in the Grid toolbar or at the last month of the Month view.',
      'Undo with the arrow in the toolbar or Cmd/Ctrl+Z; Shift redoes.',
      'Try things first: "Look at the demo first" on the welcome screen or "Open the demo sandbox" under Data; "Leave the demo" brings you back.',
    ],
    tips: ['section.income', 'section.expense', 'section.transfer', 'derived.incomeTotal', 'derived.expensesTotal', 'derived.netWorth', 'cell.appliesTo'],
    open: 'grid',
  },
  {
    key: 'people',
    title: 'People & things',
    summary: 'Tell the app who and what it pays for; each one suggests the rows it usually needs.',
    what: [
      'Under Household, "People & things" lists the adults, children, pets, vehicles, homes, companies and anything else with running costs. For anyone but an adult, "Who pays" says whose income carries the costs when money is shared in proportion: "Costs shared" or "Paid by Alex".',
      'Each kind suggests rows named subject first: "Sam – Salary", "Robin – Child benefit", "Biscuit – Food & supplies", "The car – Insurance". A row\'s person or thing can be changed any time with "Belongs to…" in the row menu.',
    ],
    steps: [
      'Household → "People & things" → "Add adult", "Add child", "Add pet", "Add vehicle", "Add home", "Add company" or "Add other".',
      'Type the name, choose "Who pays" for anyone but an adult, then "Add".',
      'Open "Suggested rows…" beside the new entry, tick the rows you want and press "Add 3 rows" (the count follows your ticks).',
      'To move a row to someone else, open the row menu (the … at the right of its name) → "Belongs to…" → "This row is for": "The household (shared)", an adult, or a name under "Other people & things".',
      'Change "Paid by …" later from the same list under Household.',
    ],
    factsTitle: 'The kinds',
    facts: kinds,
    tips: ['row.belongsTo', 'row.inShareBasis', 'household.archived'],
    open: 'household',
  },
  {
    key: 'income',
    title: 'Income',
    summary: 'Income rows are what arrives; a few switches say whose income it is and what comes off it first.',
    what: [
      'Salaries count as certain from the start; other income is an estimate until you say otherwise. "Counts for the split", inside "Belongs to…", marks the incomes that set each adult\'s share when costs are split in proportion; child benefit should stay unticked.',
      'A tax or pension contribution is a spending row of its own, marked "Deducted from an income…". The salary cell then shows "net €…" beneath the gross, the cell editor lists what was taken off under "Deducted from this income" with a "Net" line, and the shares use the net amount.',
      '"Follow another row…" makes a row mirror another month by month, whole or as a "Share (%)": a tax at 25 of a salary, or Robin\'s long-term savings following "Robin – Child benefit".',
    ],
    steps: [
      'Type the salary into "Sam – Salary" with "This month and onwards".',
      'Row menu → "Belongs to…" → tick "Counts for the split" (leave it off for child benefit).',
      'For a tax: its row menu → "Deducted from an income…" → "This expense is taken off" → "Sam – Salary". The menu item then reads "Deducted from Sam – Salary…".',
      'To mirror a row: row menu → "Follow another row…" → "Same amount as" → the row, then "Share (%)": 100 mirrors it, 25 takes a quarter. "Nothing: its own amounts" stops following.',
    ],
    tips: ['section.income', 'row.inShareBasis', 'row.deductedFrom', 'cell.deductions', 'row.follows', 'row.followShare', 'derived.incomeTotal'],
    open: 'grid',
  },
  {
    key: 'spending',
    title: 'Spending & categories',
    summary: 'Spending rows hold what leaves; categories group them, and every amount says how sure you are and what it comes out of.',
    what: [
      'Every amount is an "Estimate" (italic, dashed), "Certain" or "Done" (green dot). That changes how it looks and what the month\'s progress counts, never how it adds up. "Treat new values as…" in the row menu sets the default for new amounts in that row.',
      'A cell is a "Single amount" or "Itemized": a list of items with a "What", an amount, a status and a source each, and "Mark all done" for the whole list.',
      '"Comes out of" says where the money is taken from: "This month\'s income", the "Savings balance" or a "Pool account: Travel". Savings and pool accounts never touch the month\'s leftover. Categories ("Housing", "Living", "Transport", "Family & pets", "Fun", "Personal") group rows under a label line on a faint band.',
    ],
    steps: [
      'Open a cell and set "How sure": "Row default (Estimate)", "Estimate", "Certain" or "Done".',
      'Switch to "Itemized", press "Add item", fill "What" and the amount; "Mark all done" once everything is paid.',
      'Pick "Comes out of" → "Savings balance" or "Pool account: Travel" for spending that should not reduce the leftover.',
      'For a whole row: row menu → "Comes out of…" → "Single amounts in this row come out of" → "Applies to": "From <Month> on" or "All months, past included" → "Save".',
      'Row menu → "Treat new values as certain" (or "…as estimates") for the row\'s default.',
      'Row menu → "Category…" → pick one, "New category…" or "Add the usual categories"; rename and reorder them under Household → "Categories".',
    ],
    tips: ['section.expense', 'cell.howSure', 'cell.comesOutOf', 'row.category', 'household.categories', 'household.usualCategories', 'derived.expensesTotal', 'derived.fromSavings'],
    open: 'grid',
  },
  {
    key: 'schedules',
    title: 'Schedules',
    summary: 'Rent, insurance, subscriptions: set them once and they land in their due months by themselves.',
    what: [
      'A schedule posts an amount into a grid row in its due months: "Monthly", "Every 2 months", "Every 3 months", "Every 6 months", "Yearly" or "Specific months". The demo has "Rent" at €1,650 monthly into "The flat – Rent", "Car insurance" every 3 months into "The car – Insurance" and "Dog tax" yearly in March into "Biscuit – Costs".',
      'The grid stays in charge: change a posting for "Only this month" or "This and following months", skip a month ("Skipped this month", with "Restore"), or end the schedule. The full list lives under Household → "Schedules" with a "due", "paid" or "skipped" chip per month, and Moves lists the month\'s "Payments due".',
    ],
    steps: [
      'Click a cell → "Make recurring…" to start from that row and amount.',
      'Fill "Name", "Grid row", "Amount (EUR)", "How often", "Starting from which month of the year" (or "In which month"), "From month", "Until month (optional)", then "Save".',
      'Change one posting in the grid: "Apply the change to" → "Only this month" or "This and following months".',
      'Remove a posting: "Only this month" skips it ("Restore" brings it back), "This and following months" ends the schedule, "All occurrences" archives or deletes it.',
      'Household → "Schedules": "Add schedule", and per schedule "Edit…", "End after <Month>", "Reactivate", "Delete…"; tick a month\'s chip to mark it paid.',
      'Moves → "Payments due" lists what this month\'s schedules still owe.',
    ],
    tips: ['schedule.status', 'stat.movesLeft'],
    open: 'household',
  },
  {
    key: 'pools',
    title: 'Pool accounts',
    summary: 'Set money aside inside a savings account for one purpose and spend from it without touching the month\'s leftover.',
    what: [
      'A pool account lives inside a savings account. A transfer row fills it every month, and spending that "comes out of" it draws it down; the savings balance already includes it. In the demo, "Travel pool" moves €200 a month into "Travel", held in "Savings", and "Weekend in Lisbon" takes €480 out of it in October.',
      'The pool shows as "Pool account · Travel" under Balances, in the Month view\'s "This month" and as "€… now" under Household. Below zero it turns red. A pool account that lost its row can be filled again from "Add row" under Transfers with "Fills a pool account".',
    ],
    steps: [
      'Household → "Pool accounts" → "Add pool account" (it needs a savings account: "Add a savings account first; pool accounts live inside one.").',
      'Fill "Name", "Held in", "Already in it (EUR)", "Set aside each month (EUR)"; keep "Also add a spending row "Gifts" that comes out of it" ticked, then "Save".',
      'The row "Gifts pool" appears under Transfers; type what goes in each month.',
      'In any spending cell, "Comes out of" → "Pool account: Gifts" draws from it.',
      'Read "Pool account · Gifts" under Balances; red means more came out than went in.',
    ],
    tips: ['balance.pool', 'cell.comesOutOf', 'derived.fromSavings', 'balance.savings'],
    open: 'household',
  },
  {
    key: 'transfers',
    title: 'Transfers & the month-end rule',
    summary: 'Transfers move money between your accounts; the month-end rule decides what happens to what is left.',
    what: [
      'Deposits into savings or investments, pool rows and pocket money are transfers: not spending, so they never count as an expense; they show up as balances instead.',
      'The "Month-end rule" under "Household settings" has two settings. "Leftover goes to savings": the app works out "To savings" for you and the total row reads "Kept in account", the cash buffer you keep. "I decide the savings amount": you type "To savings" and the total reads "Leftover".',
      'A pooled household splits "Pocket money per month, all adults (EUR)" equally into automatic rows like "Sam – Pocket" and "Alex – Pocket". Automatic rows carry an (i), can be ticked when the money has moved, and cannot be typed into.',
    ],
    steps: [
      'Household → "Household settings" → "Month-end rule".',
      'Set "Pocket money per month, all adults (EUR)" and "Cash kept in the account at month end (EUR)"; "Pocket money and cash buffer changes apply to" picks "This month and onwards (earlier months keep what they show)", "Only this month" or "Every open month".',
      'Grid → Transfers → "Add row" → say what the row does: "Moves money between your accounts", "Goes into a savings account", "Deposits into an investment account", "Fills a pool account" or "Pocket money for an adult", then pick the "Account", "Pool account" or "Adult" and press "Add".',
      'Row menu → "Goes into…" changes a deposit row\'s account for every month.',
      'Moves → "Transfers to make" lists them for the month; automatic ones carry the "automatic" chip.',
    ],
    factsTitle: 'The two rules',
    facts: rules,
    tips: ['section.transfer', 'household.closingRule', 'derived.keptInAccount', 'derived.leftover', 'row.toSavingsPlug', 'row.pocketShare', 'household.pocket', 'household.buffer', 'household.pocketScope', 'row.automatic', 'stat.toSavings'],
    open: 'household',
  },
  {
    key: 'investments',
    title: 'Investment accounts',
    summary: 'Deposits grow at a yearly rate you set, or at the average of the real values you enter.',
    what: [
      'An account of type "Investments" gets a "<Name> · value" row under Balances with "Deposited" and "Return" beneath it. The demo\'s "Index fund" starts at €12,000 and grows 5% a year, fed by "To investments" at €500 a month.',
      'Click a value cell to enter what the broker says; later months continue from your number. With "Average of the real returns I enter" the projection follows your own history instead of a fixed rate. An account in another currency gets an "in EUR" line beneath its value.',
    ],
    steps: [
      'Household → "Accounts" → "Add account" → "Type": "Investments"; fill "Name", "Currency", "Opening balance", "Opening month", "Owner".',
      'Set "Growth per year (%)" and "Projection" ("Use the yearly growth" or "Average of the real returns I enter"), and "Deposits count" ("At the start of the month (they grow this month too)" or "At the end of the month (they grow from next month)").',
      'For a foreign-currency account choose "Convert deposits": "At that month\'s rate" or "At a fixed rate" with "1 EUR = ? USD". Then "Save".',
      'Grid → Transfers → "Add row" → "Deposits into an investment account" → the account; type the monthly deposit.',
      'Click "<Name> · value" in a month → "Real balance in EUR" → "Save" ("Use expected" clears it), or Household → Accounts → "Real balances" for a whole table ("Month", "Computed", "Real balance").',
      'Read "Deposited", "Return" and, for a foreign account, "in EUR" under the value row.',
    ],
    factsTitle: 'Account types',
    facts: accountTypes,
    tips: ['balance.investmentValue', 'balance.deposited', 'balance.return', 'balance.inBase', 'household.tracked', 'derived.netWorth'],
    open: 'household',
  },
  {
    key: 'debts',
    title: 'Debts & cards',
    summary: 'Loans come down with their instalments; a card\'s balance grows with what you put on it and shrinks when you pay it.',
    what: [
      'A "Loan" account shows "<Name> · outstanding" under Balances, and a payment row that names it brings the amount down. A "Credit card" shows "<Name> · owed". "How you record card spending" offers two ways: "Purchases are expense rows paid from this card; the card payment is a transfer", or "Only the card payment is recorded, as an expense".',
      'Interest is not modelled. Click a balance cell now and then to enter the real amount; later months continue from it. "Net worth" subtracts cards and loans from what you own.',
    ],
    steps: [
      'Household → "Accounts" → "Add account" → "Type": "Loan" or "Credit card"; "Opening balance" is what you owed in the "Opening month".',
      'For a card choose "How you record card spending", then "Save".',
      'Point spending rows at a card: row menu → "Paid from…" → the card (in the demo, "Subscriptions" is paid from "Credit card").',
      'Make the payment row: Grid → Expenses → "Add row" → "Pays off a loan or card" → the account → "Add". A vehicle\'s or company\'s "Suggested rows…" offers one too.',
      'Row menu → "Pays off…" re-points a payment row at another loan or card.',
      'Click "<Name> · owed" or "<Name> · outstanding" in a month → "Real balance in EUR" to correct the balance.',
    ],
    tips: ['balance.cardOwed', 'balance.loanOutstanding', 'balance.otherAsset', 'derived.netWorth', 'household.tracked'],
    open: 'household',
  },
  {
    key: 'goals',
    title: 'Goals',
    summary: 'Pick a number to reach or a debt to clear; the bar shows how far the current plan gets.',
    what: [
      'A goal is measured against the plan in the grid every month, so the bar moves when the plan changes. Four kinds: "Grow an account to an amount", "Fill a pool account", "Pay off a card or loan" and "Reach a net worth". With a target month the line says whether the plan gets there in time. Goals are the one thing on screen in gold.',
    ],
    steps: [
      'Moves → "Goals" → "Add goal".',
      'Fill "Name", "Kind", "Tracks" (the account or pool account), "Target (EUR)" (not for a pay-off), "Target month (optional)" and "Notes", then "Save".',
      'Read the line under the bar: it says how far the plan gets ("€… of €… · reached by <Month> (target <Month>)"), when it is late ("… after the target of <Month>"), or that the goal is done ("Reached in <Month>", or "Nothing owed" for a debt).',
      '"Edit" or "Delete…" from the goal\'s menu; the Month view shows the same bars under "Goals".',
    ],
    factsTitle: 'Goal kinds',
    facts: goalKinds,
    tips: ['goal.status'],
    open: 'moves',
  },
  {
    key: 'sharing',
    title: 'Sharing money',
    summary: 'Pool all income with pocket money, or split shared costs in proportion to what each adult brings in.',
    what: [
      '"How you share money" under "Household settings" is either "Pooled, with pocket money" or "In proportion to income". Pooled: all income is household money, each adult gets pocket money, and Moves shows "Per person" with "Income", "Own spending", "Pocket money" and "Leaves for the household".',
      'In proportion: Household shows "Who pays what" with "Shares come from" ("Salaries", "All income" or "Percentages I set") and a table of "Share", "Income", "Pays this month" and "Keeps" per adult. Moves splits every shared line by share, lists "own" and "pays for" lines in full, and ends with "Transfers per person": who sends what to which account. Robin\'s rows go to Alex because Robin is "Paid by Alex".',
    ],
    steps: [
      'Household → "Household settings" → "How you share money".',
      'In proportion: "Who pays what" → "Shares come from"; with "Percentages I set", type the "Shares (%)" and press "Apply".',
      'Mark the incomes that set the shares: row menu → "Belongs to…" → "Counts for the split".',
      'Under "People & things", set "Paid by Alex" or "Costs shared" for each child, pet or thing.',
      'Read Moves: "Who pays what" ("Pays this month", "Income", "Keeps", "Transfers per person" with "→ <account>" lines) or, pooled, "Per person".',
    ],
    factsTitle: 'The two ways, and what a proportional split is based on',
    facts: sharing,
    tips: ['household.moneyMode', 'household.shareBasis', 'row.inShareBasis', 'row.belongsTo', 'row.pocketShare', 'household.pocket'],
    open: 'household',
  },
  {
    key: 'currencies',
    title: 'Currencies',
    summary: 'Rows and accounts can be in another currency; the grid shows what they are worth in EUR at each month\'s rate.',
    what: [
      '"Currency…" in the row menu sets a row\'s currency. The cell keeps the typed amount and shows "≈ €…" beneath; the row\'s name carries the code. The cell editor adds a rate line, "≈ €… · 1 EUR = 1.08 USD · ECB · 2 Nov 2026", with a chip that says where the rate came from: "ECB", "manual", "projected", "carried" or "missing".',
      'Rates live under Household → "Currency rates": "Fetch ECB rates" asks the European Central Bank (only currency codes and dates leave the device), "Month rate" picks the day of the month, "Future months" how the rate drifts. Rates are always spelled with both codes in the direction whose number is at least 1.',
    ],
    steps: [
      'Row menu → "Currency…" → "Amounts in this row are in" (the first entry, "EUR (household currency)", is the default) → "Save".',
      'Open a cell of that row; under the amount, "Change this month\'s rate…" → type after "1 USD =" → "Save rate". One rate per currency per month, for every row in it.',
      '"Use the ECB rate again" drops a manual rate for the published one.',
      'Household → "Currency rates" → "Fetch ECB rates" fills the past months.',
      '"Month rate": "First business day of the month", "Last business day of the month" or "Average over the month".',
      '"Future months": "Change by a fixed % each month" with "Change per month (%)", or "Repeat the average change of the last year"; "Use for EUR/USD" keeps a rule for one pair, "Back to the default" clears it.',
      'Type over a month in the "1 EUR in USD" column to set it by hand; empty it to go back.',
    ],
    tips: ['row.currency', 'cell.rate', 'balance.inBase'],
    open: 'household',
  },
  {
    key: 'month',
    title: 'Month view & ticking off',
    summary: 'One month as a list with a tick on every line: the phone\'s first screen and the place to mark what has moved.',
    what: [
      'The Month view lists the month by section with a tick on every line. The progress line counts: "7 of 21 done · €… still to pay · €… to come in", then "All 21 done" or "Closed · all done". "Hide done" trims the list.',
      'One tap on the tick marks a line done, another takes it back; an itemized line opens to tick item by item. Tapping the line itself opens its sheet, titled with the line\'s name, to record what actually moved: "Amount in EUR", "Date", "How sure", "Note"; only that month changes. "Close month" locks the month; "Reopen month" unlocks it.',
    ],
    steps: [
      'Move between months with the arrows beside the month name; "Add <year>" at the end grows the plan.',
      'Tick "The flat – Rent" once the rent has left.',
      'Tap the line → "Amount in EUR", "Date", "Done", "Note" → "Save"; "Open full editor" for the whole cell.',
      '"Hide done" to see only what is still open.',
      '"Close month" when everything has moved: the month gets a lock and a "closed" chip, and its grid column greys out. "Reopen month" undoes it (also from a month name in the Grid and "Reopen <Month>" in the editor).',
    ],
    tips: ['month.progress', 'cell.howSure', 'row.automatic', 'stat.toSavings', 'derived.keptInAccount', 'derived.leftover'],
    open: 'month',
  },
  {
    key: 'remove',
    title: 'Archive or delete',
    summary: 'One dialog removes anything; it says what archiving keeps, what deleting removes, and refuses what would change a closed month.',
    what: [
      '"Archive or delete…" sits in every row menu, beside each person or thing, and in the account and pool account dialogs; goals and schedules have "Delete…". Archiving hides something from a month on and keeps every earlier month exactly as it was. Anything with amounts in a closed month cannot be deleted at all, only archived.',
      'The dialog lists "Deleting removes", "Also changes" and "Resolve these first" before you decide. Every removal is one undoable step, and archived things wait under Household with "Restore".',
    ],
    steps: [
      'Row menu → "Archive or delete…".',
      'Choose "Archive from" a month → "Archive from <Month>"; or "Delete" once "Resolve these first" is empty.',
      'If it says "…has amounts in closed months (…), so it cannot be deleted. Archive it instead.", archive it.',
      'Changed your mind? Undo right after.',
      'Bring something back: "Archived rows", or the "Archived" line under "Accounts", "Pool accounts" and "People & things" → "Restore".',
    ],
    tips: ['remove.archiveFrom', 'household.archived'],
    open: 'household',
  },
  {
    key: 'data',
    title: 'Data, sync & privacy',
    summary: 'Your data lives in this browser; export a file now and then, or sign in to keep an encrypted copy in the cloud.',
    what: [
      '"Where your data lives" under Data says it plainly: in this browser, on this device. "Ask the browser to keep my data" asks it not to evict the store. "Export now" writes one JSON file with every table and the change history; "Choose a file…" reads one back, to "Merge into this device" or "Replace everything here".',
      'Cloud sync is optional and by invitation: "Sign in" or "I have an invite". Everything is encrypted on the device before it leaves, only your password opens it, and a recovery code shown once is the way back in. Apart from that, only currency codes and dates ever leave the device, when rates are fetched. "Demo household" opens the sandbox; the "Danger zone" wipes.',
    ],
    steps: [
      'Data → "Export" → "Export now"; keep the file anywhere you like.',
      '"Import" → "Choose a file…" → "Merge into this device" or "Replace everything here".',
      '"Cloud sync" → "Sign in" ("Email", "Password"), or "I have an invite" ("Invite code", "Email", "New password", "New password again" → "Create account" → "Your recovery code" → "I have stored it").',
      'Signed in: "Sync now", "Change password…", "New recovery code…", "Sign out". The owner invites with "Invite someone" → "Copy link".',
      '"Demo household": "Open the demo sandbox" or "Load demo household"; "Leave the demo" returns.',
      '"Danger zone": type WIPE for "Wipe this device" (or "Sign out and wipe this device"), DELETE for "Delete the cloud copy".',
    ],
    tips: ['data.export', 'sync.privacy'],
    open: 'data',
  },
  {
    key: 'marks',
    title: 'Marks & keyboard',
    summary: 'Every kind of money has one colour and every mark one meaning; the keyboard moves you around the grid.',
    what: [
      '"What the colours and marks mean" in the Grid and Month toolbars is the legend. Kinds of money: "Income", "Expenses", "Transfers", "Balances and net worth", "Pool accounts", "Goals". Marks: an estimate is italic with a dashed underline, certain is plain, done has a green dot; in the current month a red ring means nothing done yet and an amber half-dot partly done.',
      'Spending shows as a red negative number when "Show expenses as negative red numbers" is on; an amber "+€…" is money drawn from savings this month; a dotted underline is a balance you entered yourself; a lock is a closed month; a faint band is one category\'s rows.',
      'In the grid the arrow keys move between cells, Enter or Space opens one, Escape closes the editor. Cmd/Ctrl+Z undoes and Shift redoes, like the two arrows at the left of every toolbar.',
    ],
    steps: [
      'Open "What the colours and marks mean" from the Grid or Month toolbar.',
      'Click a cell, then move with the arrow keys; Enter opens it, Escape closes it.',
      'Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z redoes.',
      'Household → "Household settings" → "Show expenses as negative red numbers" switches the red negatives.',
    ],
    tips: ['cell.howSure', 'row.automatic'],
    open: 'grid',
  },
]
