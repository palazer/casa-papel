import { ACCOUNT_TYPE_INFO, ENTITY_KIND_HELP, ENTITY_KIND_LABEL, GOAL_KIND_INFO, RULE_KIND_INFO, type EntityKind } from '@/model'
import type { HelpKey } from './help'
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
    'Casa Papel is local-first household budgeting that knows what a household is: who lives in it, what it owns, what recurs, what is saved for. It opens on the Statement, one month in accounting form with money in beside money out and what you have beside what you owe; the Grid plans the months ahead. It runs in your browser, on your phone as well as your laptop, and works offline.',
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
const rules: GuideFact[] = RULE_KIND_INFO.map((r) => ({ label: r.label, text: r.help }))
const accountTypes: GuideFact[] = ACCOUNT_TYPE_INFO.map((a) => ({ label: a.label, text: a.help }))
const goalKinds: GuideFact[] = GOAL_KIND_INFO.map((g) => ({ label: g.label, text: g.help }))

export const GUIDE: GuideTopic[] = [
  {
    key: 'statement',
    title: 'Start & the Statement',
    summary: 'One month on one page: money in beside money out, and under it what you have beside what you owe. The first screen, and the place to tick what has moved.',
    what: [
      'The Statement shows one month in two halves that always balance. "The month" has "Money in" on the left and "Money out" on the right; what is neither spent nor set aside closes the right side as the rest. "At the end of the month" has "Assets" on the left and "Debts and net worth" on the right, with a "change" column for how the month moved each figure. A category opens to its rows, an itemized row to its items.',
      'Every line with an amount has a tick, and the progress line under the toolbar counts them: "7 of 21 done · €… still to pay · €… to come in", then "All 21 done" or "Closed · all done". An estimate sits on a light yellow shade; press a line to overwrite its amount or to say how sure you are. A line the app works out carries its rule as a small symbol, and the same dialog opens on that rule.',
      '"Close month" locks the month: its numbers stay as they are and all of it counts as done; "Reopen month" unlocks it. With two or more adults the page ends with "Per person". While a household is new, the "Setting up" guide at the top leads through the page in six steps, and "Suggestions" offers the usual rows where they will appear.',
    ],
    steps: [
      'A new household: "Start on this device" on the welcome screen, then "Household name", "Currency", "Number and date format", "First month" and the people and things, and "Open the Statement". The Statement opens on the first month with the "Setting up" guide: "Your first income", "Your first expenses", "Savings, and where the rest goes", "Your first virtual account", "Your first investment" and "Loans and cards". Type an amount on a suggested line and press Enter; "Skip" or "Next" moves on, and "Leave setup" puts the guide away.',
      'Move between months with the arrows beside the month name; "Add <year>" at the last month grows the plan.',
      'Open a category, "Housing" say, and tick "The flat – Rent" once the rent has left; a second press takes the tick back. An itemized row opens to its items, each with a tick of its own.',
      'Press a line, "The flat – Utilities" say, to record what it really was: "Amount in EUR", "Only this month", "Certain", then "Save".',
      '"Expand all" and "Collapse all" open and close every category at once; "What the colours and marks mean" is the legend.',
      '"Close month" when everything has moved: the month gets a "closed" chip and its grid column greys out. "Reopen month" undoes it (also from a month name in the Grid and "Reopen <Month>" in the editor).',
      'To plan the months ahead, open the Grid; a month name there → "Open in the Statement" comes back to that month.',
      'Try things first: "Look at the demo first" on the welcome screen or "Open the demo sandbox" under Data; "Leave the demo" brings you back.',
    ],
    tips: ['statement.progress', 'cell.howSure', 'row.automatic', 'derived.keptInAccount', 'derived.leftover', 'statement.month', 'statement.position', 'statement.setAside', 'statement.fromAccounts', 'statement.setup', 'statement.suggestions', 'statement.mainAccount', 'statement.netWorth', 'statement.free', 'statement.perPerson'],
    open: 'statement',
  },
  {
    key: 'grid',
    title: 'The grid: planning ahead',
    summary: 'The Grid is the plan across time: months across, rows down, three sections and the balances beneath.',
    what: [
      'Every screen reads the same plan. The Grid shows it across time: one column per month from the current one on, one row per thing that comes in, goes out or moves, under the sections "Income", "Expenses" and "Transfers", with "Balances" and "Net worth" beneath. An amount carries forward until you change it, so a plan for a year is a handful of entries.',
      '"Earlier months" in the toolbar brings back the months before the current one and stays as you left it on this device; the sums count every month either way. A month name opens a menu with that month\'s totals, "Open in the Statement", and "Close month" or "Reopen month".',
      'The plan always ends in a December. "Add <year>" in the toolbar grows it by a calendar year, and a change beyond the end grows it by itself. Every change is one undoable step: the two arrows at the left of every toolbar take it back and forward.',
    ],
    steps: [
      'Click a cell, "Groceries" in this month, say; type in "Amount in EUR" and press "Save".',
      'Under "Applies to", keep "This month and onwards" to change this month and every later month that still follows it, or pick "Only this month".',
      'Add a row with "Add row" at the foot of a section: a "Row name", a category when the section has any, then "Add".',
      '"Earlier months (2)" shows the months before the current one, the number says how many; press it again to start at this month.',
      'Click a month name → "Open in the Statement" to read and tick that month there.',
      'Grow the plan with "Add <year>" in the Grid toolbar or at the last month of the Statement.',
      'Undo with the arrow in the toolbar or Cmd/Ctrl+Z; Shift redoes.',
    ],
    tips: ['section.income', 'section.expense', 'section.transfer', 'derived.incomeTotal', 'derived.expensesTotal', 'derived.netWorth', 'cell.appliesTo'],
    open: 'grid',
  },
  {
    key: 'people',
    title: 'People & things',
    summary: 'Tell the app who and what it pays for; each one suggests the rows it usually needs.',
    what: [
      'Under Household, "People & things" lists the adults, children, pets, vehicles, homes, companies and anything else with running costs.',
      'Each kind suggests rows named subject first: "Sam – Salary", "Robin – Child benefit", "Biscuit – Food & supplies", "The car – Insurance". A row\'s person or thing can be changed any time with "Belongs to…" in the row menu.',
    ],
    steps: [
      'Household → "People & things" → "Add adult", "Add child", "Add pet", "Add vehicle", "Add home", "Add company" or "Add other".',
      'Type the name, then "Add".',
      'Open "Suggested rows…" beside the new entry, tick the rows you want and press "Add 3 rows" (the count follows your ticks). Or Statement → "Suggestions": the same rows are offered where they will appear, each with a field for its monthly amount.',
      'To move a row to someone else, open the row menu (the … at the right of its name) → "Belongs to…" → "This row is for": "The household (shared)", an adult, or a name under "Other people & things".',
    ],
    factsTitle: 'The kinds',
    facts: kinds,
    tips: ['row.belongsTo', 'household.archived'],
    open: 'household',
  },
  {
    key: 'income',
    title: 'Income',
    summary: 'Income rows are what arrives; a few switches say whose income it is and what comes off it first.',
    what: [
      'Salaries count as certain from the start; other income is an estimate until you say otherwise. An income line that belongs to an adult ("Belongs to…") is that adult\'s own: it shows under their name in "Per person" under the Statement, and a pocket money rule can take a percentage of it.',
      'A tax or pension contribution is a spending row of its own, marked "Deducted from an income…". The salary cell then shows "net €…" beneath the gross, the cell editor lists what was taken off under "Deducted from this income" with a "Net" line, and percentages of income use the net amount.',
      '"Follow another row…" makes a row mirror another month by month, whole or as a "Share (%)": a tax at 25 of a salary, or Robin\'s long-term savings following "Robin – Child benefit".',
    ],
    steps: [
      'Statement → "Money in" → press "Sam – Salary" and type the salary with "This month and onwards".',
      'Row menu (the … after the row\'s name, on the Statement and in the Grid) → "Belongs to…" → "This row is for" → "Sam" makes it Sam\'s own income; "Robin – Child benefit" stays with Robin.',
      'For a tax: its row menu → "Deducted from an income…" → "This expense is taken off" → "Sam – Salary". The menu item then reads "Deducted from Sam – Salary…".',
      'To mirror a row: row menu → "Follow another row…" → "Same amount as" → the row, then "Share (%)": 100 mirrors it, 25 takes a quarter. "Nothing: its own amounts" stops following.',
    ],
    tips: ['section.income', 'row.deductedFrom', 'cell.deductions', 'row.follows', 'row.followShare', 'derived.incomeTotal'],
    open: 'statement',
  },
  {
    key: 'spending',
    title: 'Spending & categories',
    summary: 'Spending rows hold what leaves; categories group them, and every amount says how sure you are and what it comes out of.',
    what: [
      'Every amount is an "Estimate" (on a light yellow shade), "Certain" or "Done" (green dot). That changes how it looks and what the month\'s progress counts, never how it adds up. "Treat new values as…" in the row menu sets the default for new amounts in that row.',
      'A cell is a "Single amount" or "Itemized": a list of items with a "What", an amount, a status and a source each, and "Mark all done" for the whole list.',
      '"Comes out of" says where the money is taken from: "This month\'s income", the "Savings balance" or a "Virtual account: Travel". Savings and virtual accounts never touch the month\'s leftover. Categories ("Housing", "Living", "Transport", "Family & pets", "Fun", "Personal") group rows under a label line on a faint band.',
    ],
    steps: [
      'Press a line on the Statement, or a cell in the Grid, and set "How sure": "Row default (Estimate)", "Estimate", "Certain" or "Done".',
      'Switch to "Itemized", press "Add item", fill "What" and the amount; "Mark all done" once everything is paid.',
      'Pick "Comes out of" → "Savings balance" or "Virtual account: Travel" for spending that should not reduce the leftover.',
      'For a whole row: row menu → "Comes out of…" → "Single amounts in this row come out of" → "Applies to": "From <Month> on" or "All months, past included" → "Save".',
      'Row menu → "Treat new values as certain" (or "…as estimates") for the row\'s default.',
      'Row menu → "Category…" → pick one, "New category…" or "Add the usual categories"; rename and reorder them under Household → "Categories".',
    ],
    tips: ['section.expense', 'cell.howSure', 'cell.comesOutOf', 'row.category', 'household.categories', 'household.usualCategories', 'row.categoryEstimate', 'derived.expensesTotal', 'derived.fromSavings'],
    open: 'statement',
  },
  {
    key: 'schedules',
    title: 'Schedules',
    summary: 'Rent, insurance, subscriptions: set them once and they land in their due months by themselves.',
    what: [
      'A schedule posts an amount into a grid row in its due months: "Monthly", "Every 2 months", "Every 3 months", "Every 6 months", "Yearly" or "Specific months". The demo has "Rent" at €1,650 monthly into "The flat – Rent", "Car insurance" every 3 months into "The car – Insurance" and "Dog tax" yearly in March into "Biscuit – Costs".',
      'The grid stays in charge: change a posting for "Only this month" or "This and following months", skip a month ("Skipped this month", with "Restore"), or end the schedule. The full list lives under Household → "Schedules" with a "due", "paid" or "skipped" chip per month; on the Statement a posting is its row\'s amount and is ticked like any other line.',
    ],
    steps: [
      'Press a line on the Statement, or a cell in the Grid → "Make recurring…" to start from that row and amount.',
      'Fill "Name", "Grid row", "Amount (EUR)", "How often", "Starting from which month of the year" (or "In which month"), "From month", "Until month (optional)", then "Save".',
      'Change one posting in the grid: "Apply the change to" → "Only this month" or "This and following months".',
      'Remove a posting: "Only this month" skips it ("Restore" brings it back), "This and following months" ends the schedule, "All occurrences" archives or deletes it.',
      'Household → "Schedules": "Add schedule", and per schedule "Edit…", "End after <Month>", "Reactivate", "Delete…"; tick a month\'s chip to mark it paid.',
      'Statement → open "Housing" and tick "The flat – Rent" once it is paid: the schedule shows "paid" for that month, and the progress line counts what is still to pay.',
    ],
    tips: ['schedule.status', 'statement.progress'],
    open: 'household',
  },
  {
    key: 'virtual-accounts',
    title: 'Virtual accounts',
    summary: 'Set money aside inside a savings account for one purpose and spend from it without touching the month\'s leftover.',
    what: [
      'A virtual account lives inside a savings account. A transfer row fills it every month, and spending that "comes out of" it draws it down; the savings balance already includes it. In the demo, "To Travel" moves €200 a month into "Travel", held in "Savings", and "Weekend in Lisbon" takes €480 out of it in October.',
      'It shows as "Virtual account · Travel" under Balances in the Grid, on a line of its own under its savings account on the Statement, and as "€… now" under Household. It never goes below zero: when an expense takes more than it holds, its line on the Statement says "short" and offers "Top up…". A virtual account that lost its row can be filled again from "Add row" under Transfers with "Fills a virtual account".',
    ],
    steps: [
      'Statement → "Assets" → "Add virtual account", or Household → "Virtual accounts" → "Add virtual account" (it needs a savings account: "Add a savings account first; virtual accounts live inside one.").',
      'Fill "Name", "Held in", "Already in it (EUR)", "Set aside each month (EUR)"; keep "Also add a spending row "Gifts" that comes out of it" ticked, then "Save".',
      'The row "To Gifts" appears under Transfers; type what goes in each month.',
      'In any spending cell, "Comes out of" → "Virtual account: Gifts" draws from it.',
      'Read it under its savings account on the Statement, or as "Virtual account · Gifts" under Balances in the Grid; a "short" chip means an expense took more than it held, and "Top up…" fills the gap.',
    ],
    tips: ['balance.pool', 'cell.comesOutOf', 'derived.fromSavings', 'balance.savings'],
    open: 'household',
  },
  {
    key: 'transfers',
    title: 'Transfers & the rest of the month',
    summary: 'Transfers move money between your accounts; a rule per account says how much goes to it, and one account can take the rest.',
    what: [
      'Deposits into savings or investments, the rows that fill virtual accounts and pocket money are transfers: not spending, so they never count as an expense; they show up as balances instead.',
      'Every transfer into a savings account, an investment account or a virtual account has a rule that says how its amount is worked out. One account at a time can take "The rest", and the same account fills the gap in a month that overruns. While an account takes the rest, the total row reads "Kept in account", the cash buffer you keep; while none does, it reads "Leftover".',
      'Pocket money is a line per adult, like "Sam – Pocket" and "Alex – Pocket", with a rule of its own: "A fixed amount", "A percentage of income", "A percentage of Sam\'s income", "A percentage of one income" or "A percentage of what is left", never the rest. Rows the app works out carry an (i), can be ticked when the money has moved, and cannot be typed into.',
    ],
    steps: [
      'Statement → "To savings, investments and debts" → press a transfer like "To investments": one dialog holds its amount and its rule, under "How the amount is set". The symbol beside an account or a virtual account under "Assets" opens the same dialog, and so does Grid → row menu → "Rule…".',
      'Pick "A fixed amount", "A percentage of income", "A percentage of one income", "A percentage of what is left" or "The rest". A fixed amount is typed with "Applies to"; for a percentage or the rest, "Counts from" is the month the rule starts in, and earlier months keep their amounts.',
      'To pass one income on in full, pick "A percentage of one income", choose it under "Which income" and type 100: in the demo, "Robin – Child benefit" into "To investments". The amount follows that income line, after what is deducted from it.',
      'Household → "Household settings" → "Cash kept in the account at month end (EUR)"; "Cash buffer changes apply to" picks "This month and onwards (earlier months keep what they show)", "Only this month" or "Every open month".',
      'Statement → "To savings, investments and debts" → "Add row" → "What is it for?": "Goes into a savings account", "Deposits into an investment account", "Fills a virtual account", "Pays off a loan or card", "Pocket money for an adult" or "Moves money between your accounts". Pick the account under "Which one"; "New savings account…" and the entries like it make the account and the row together. The name may stay empty: the row is called after its account. Grid → Transfers → "Add row" asks the same after the name.',
      'Row menu → "Goes into…" changes a deposit row\'s account for every month.',
      'What is not passed on stays in the current accounts: Statement → "Assets" → press the amount of "Current accounts" (or its row under "Balances" in the Grid) to type what the bank says for each account. The line then shows how far the plan was off, and later months continue from the real numbers; "Use the calculated amount" takes it back.',
      'Statement → "To savings, investments and debts" and "Pocket money" list them for the month, each with a tick for when the money has moved.',
    ],
    factsTitle: 'The rules',
    facts: rules,
    tips: ['section.transfer', 'derived.keptInAccount', 'derived.leftover', 'row.toSavingsPlug', 'household.buffer', 'household.bufferScope', 'row.automatic', 'row.rule', 'row.ruleFrom', 'statement.mainAccount'],
    open: 'household',
  },
  {
    key: 'investments',
    title: 'Investment accounts',
    summary: 'Deposits grow at a yearly rate you set, or at the average of the real values you enter.',
    what: [
      'An account of type "Investments" gets a "<Name> · value" row under Balances with "Deposited" and "Return" beneath it. The demo\'s "Index fund" starts at €12,000 and grows 5% a year, fed by "To investments" at €500 a month.',
      'Click a value cell to enter what the broker says; later months continue from your number. With "Average of the real returns I enter" the projection follows your own history instead of a fixed rate. An account in another currency gets an "in EUR" line beneath its value. A savings or investment account added on the Statement is asked "How much goes to <account>?" as soon as it is saved, and an account whose "Owner" is a child feeds that child\'s long-term savings row.',
    ],
    steps: [
      'Statement → "Assets" → "Add account" (or Household → "Accounts" → "Add account") → "Type": "Investments"; fill "Name" and "Holds at the start of <Month>". "More options" holds "Currency", "Opening month" and "Owner". After "Save" on the Statement, "How much goes to <account>?" asks for its monthly rule.',
      'Under "More options" set "Growth per year (%)" and "Projection" ("Use the yearly growth" or "Average of the real returns I enter"), and "Deposits count" ("At the start of the month (they grow this month too)" or "At the end of the month (they grow from next month)").',
      'For a foreign-currency account choose "Convert deposits": "At that month\'s rate" or "At a fixed rate" with "1 EUR = ? USD". Then "Save".',
      'Grid → Transfers → "Add row" → "Deposits into an investment account" → the account; type the monthly deposit.',
      'Statement → "Assets" → press the account\'s balance, or Grid → "<Name> · value" in a month → "Real balance in EUR" → "Save" ("Use expected" clears it); Household → Accounts → "Real balances" has a whole table ("Month", "Computed", "Real balance").',
      'Read "Deposited", "Return" and, for a foreign account, "in EUR" under the value row.',
    ],
    factsTitle: 'Account types',
    facts: accountTypes,
    tips: ['balance.investmentValue', 'balance.deposited', 'balance.return', 'balance.inBase', 'household.tracked', 'setup.owner', 'derived.netWorth'],
    open: 'household',
  },
  {
    key: 'debts',
    title: 'Debts & cards',
    summary: 'Loans come down with their instalments; a card\'s balance grows with what you put on it and shrinks when you pay it.',
    what: [
      'A "Loan" account shows "<Name> · outstanding" under Balances, and a payment row that names it brings the amount down. A "Credit card" shows "<Name> · owed". "What do you record for this card?" has two answers: "Everything I buy with it" (each purchase is an expense row that names the card, and the payment only moves money) or "Only what I pay to it" (the payment is the spending). Where the payment row lives follows from that: under Transfers for the first, under Expenses for the second.',
      'Interest is not modelled. Click a balance cell now and then to enter the real amount; later months continue from it. "Net worth" subtracts cards and loans from what you own.',
    ],
    steps: [
      'Statement → "Debts and net worth" → "Add a card or loan" (or Household → "Accounts" → "Add account"): "Name", "Type" ("Loan" or "Credit card") and "Owed at the start of <Month>", what you owed when that month began.',
      'For a card answer "What do you record for this card?". "Add the row that pays it off" is ticked: "Save" makes the loan or card and its payment row together, and on the Statement the row\'s dialog opens for the amount.',
      'Point spending rows at a card: row menu → "Paid from…" → the card (in the demo, "Subscriptions" is paid from "Credit card").',
      'A payment row can come later, or first. Later: the "…" of the loan or card → "Add the row that pays it off". First: Statement → "To savings, investments and debts" → "Add row" → "Pays off a loan or card" → the account, or "New loan…" to make both together; a category\'s "Add row to Transport" offers the same, and the page then shows where the line landed. In the Grid it is Expenses → "Add row" → "Pays off a loan or card", and Transfers → "Pays off a credit card" for a card whose purchases are expense rows. A vehicle\'s or company\'s suggestions offer a loan row too, with "Add a loan…" while there is none.',
      'Row menu → "Pays off…" re-points a payment row at another loan or card.',
      'Statement → "Debts and net worth" → press the balance, or Grid → "<Name> · owed" or "<Name> · outstanding" in a month → "Real balance in EUR" to correct the balance.',
    ],
    tips: ['balance.cardOwed', 'balance.loanOutstanding', 'balance.otherAsset', 'derived.netWorth', 'household.tracked'],
    open: 'household',
  },
  {
    key: 'goals',
    title: 'Goals',
    summary: 'Pick a number to reach or a debt to clear; the bar shows how far the current plan gets.',
    what: [
      'A goal is measured against the plan in the grid every month, so the bar moves when the plan changes. Two kinds: "Fill an account" (an account or a virtual account reaches an amount) and "Pay down a debt" (a card or loan comes down to an amount, usually zero); net worth can have a goal too. With a target month the line says whether the plan gets there in time. Goals are the one thing on screen in gold.',
    ],
    steps: [
      'Statement → hover a line under "Assets" or "Debts and net worth" → "Set a goal for …". What the goal watches is then settled: fill "Name", "Target (EUR)", or "Bring it down to (EUR)" for a debt, "Target month (optional)" and "Notes", then "Save".',
      'A goal on net worth starts the same way, from the "Net worth" line. A line with a goal carries a small gold mark with how far it is.',
      'Read the line under the bar: it says how far the plan gets ("€… of €… · reached by <Month> (target <Month>)"), when it is late ("… after the target of <Month>"), or that the goal is done ("Reached in <Month>", or "Nothing owed" for a debt brought to zero).',
      'Open the line to see the goal\'s bar; "Edit" beside its name changes it, and "Delete…" in that dialog removes it.',
    ],
    factsTitle: 'Goal kinds',
    facts: goalKinds,
    tips: ['goal.status'],
    open: 'statement',
  },
  {
    key: 'pocket-money',
    title: 'Pocket money & per person',
    summary: 'Each adult has a pocket money line with an amount or a rule of its own; "Per person" under the Statement shows what each adult brings and takes.',
    what: [
      'Pocket money is a line per adult under "Pocket money" on the Statement: "Sam – Pocket", "Alex – Pocket". Each line has its own amount or its own rule, so two adults can take different amounts, and nothing is set for the household as a whole. How much each adult puts into the household is what their income lines say.',
      'With two or more adults, the Statement ends with "Per person": "Income", "Own spending", "Pocket money" and "Leaves for the household" for each. A row counts for an adult when it belongs to them ("Belongs to…" in the row menu); rows for Robin, Biscuit, The car or The flat are the household\'s.',
    ],
    steps: [
      'Statement → "Suggestions" → under "Expenses", type an amount beside "Sam – Pocket" and press Enter; or press "Add" with the field empty to be asked for a rule.',
      'To change it, press "Sam – Pocket" (or Grid → row menu → "Rule…"). "How the amount is set" offers "A fixed amount", "A percentage of income", "A percentage of Sam\'s income", "A percentage of one income" and "A percentage of what is left".',
      'A fixed amount is typed with "Applies to": "This month and onwards" or "Only this month". For a percentage, "Counts from" is the month the rule starts in; earlier months keep what they showed.',
      'For a line of your own: "Add row" under Transfers → "Pocket money for an adult" → pick the "Adult".',
      'Say whose a row is: row menu → "Belongs to…" → "This row is for". A percentage of Sam\'s income counts the income lines that belong to Sam.',
      'Read "Per person" under the Statement\'s two halves to see what each adult leaves for the household this month.',
    ],
    tips: ['row.belongsTo', 'row.rule', 'row.ruleFrom', 'statement.perPerson'],
    open: 'statement',
  },
  {
    key: 'currencies',
    title: 'Currencies',
    summary: 'Rows and accounts can be in another currency; the grid shows what they are worth in EUR at each month\'s rate.',
    what: [
      '"Currency…" in the row menu sets a row\'s currency. The cell keeps the typed amount and shows "≈ €…" beneath; the row\'s name carries the code. The cell editor adds a rate line, "≈ €… · 1 EUR = 1.08 USD · ECB · 2 Nov 2026", with a chip that says where the rate came from: "ECB", "manual", "projected", "carried" or "missing".',
      'A currency gets its rates from the European Central Bank by itself the first time it is used (only currency codes and dates leave the device). They live under Household → "Currency rates": "Fetch ECB rates" asks again, "Month rate" picks the day of the month, "Future months" how the rate drifts. Rates are always spelled with both codes in the direction whose number is at least 1.',
    ],
    steps: [
      'Row menu → "Currency…" → "Amounts in this row are in" (the first entry, "EUR (household currency)", is the default) → "Save".',
      'Open a cell of that row; under the amount, "Change this month\'s rate…" → type after "1 USD =" → "Save rate". One rate per currency per month, for every row in it.',
      '"Use the ECB rate again" drops a manual rate for the published one.',
      'An account\'s currency is under "More options" in its dialog. Household → "Currency rates" → "Fetch ECB rates" fills the months since the last fetch, and is the way back after being offline.',
      '"Month rate": "First business day of the month", "Last business day of the month" or "Average over the month".',
      '"Future months": "Change by a fixed % each month" with "Change per month (%)", or "Repeat the average change of the last year"; "Use for EUR/USD" keeps a rule for one pair, "Back to the default" clears it.',
      'Type over a month in the "1 EUR in USD" column to set it by hand; empty it to go back.',
    ],
    tips: ['row.currency', 'cell.rate', 'balance.inBase'],
    open: 'household',
  },
  {
    key: 'remove',
    title: 'Archive or delete',
    summary: 'One dialog removes anything; it says what archiving keeps, what deleting removes, and refuses what would change a closed month.',
    what: [
      '"Archive or delete…" sits in every row menu, beside each person or thing, and in the account and virtual account dialogs; goals and schedules have "Delete…". Archiving hides something from a month on and keeps every earlier month exactly as it was. Anything with amounts in a closed month cannot be deleted at all, only archived.',
      'The dialog lists "Deleting removes", "Also changes" and "Resolve these first" before you decide. Every removal is one undoable step, and archived things wait under Household with "Restore".',
    ],
    steps: [
      'Row menu (the "…" beside a row\'s name in the Grid and on the Statement) → "Archive or delete…". On the Statement a category, an account and a virtual account have a "…" too.',
      'Choose "Archive from" a month → "Archive from <Month>"; or "Delete" once "Resolve these first" is empty.',
      'If it says "…has amounts in closed months (…), so it cannot be deleted. Archive it instead.", archive it.',
      'Changed your mind? Undo right after.',
      'While a new household still shows "Setting up" on the Statement, the entry reads "Delete" and deletes at once; "Deleted …" appears at the foot of the window with "Undo". If more than the thing itself would change, the dialog still opens.',
      'Bring something back: "Archived rows", or the "Archived" line under "Accounts", "Virtual accounts" and "People & things" → "Restore".',
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
      '"What the colours and marks mean" in the Statement and Grid toolbars is the legend. Kinds of money: "Income", "Expenses", "Transfers", "Balances and net worth", "Virtual accounts", "Goals". Marks: an estimate sits on a light yellow shade, certain is plain, done has a green dot; in the current month a red ring means nothing done yet and an amber half-dot partly done.',
      'Spending shows as a red negative number when "Show expenses as negative red numbers" is on; an amber "+€…" is money drawn from savings this month; a dotted underline is a balance you entered yourself; a lock is a closed month; a faint band is one category\'s rows. On the Statement two chain rings mark a row and the account it fills, takes from or pays off: press them to go to the other end, which is marked for a moment. Faint, open rings on a loan or card mean no row pays it off yet; pressing them adds the row.',
      'In the grid the arrow keys move between cells, Enter or Space opens one, Escape closes the editor. Cmd/Ctrl+Z undoes and Shift redoes, like the two arrows at the left of every toolbar.',
    ],
    steps: [
      'Open "What the colours and marks mean" from the Statement or Grid toolbar.',
      'Click a cell, then move with the arrow keys; Enter opens it, Escape closes it.',
      'Cmd/Ctrl+Z undoes, Cmd/Ctrl+Shift+Z redoes.',
      'Household → "Household settings" → "Show expenses as negative red numbers" switches the red negatives.',
    ],
    tips: ['cell.howSure', 'row.automatic'],
    open: 'grid',
  },
]
