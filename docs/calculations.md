# How Casa Papel calculates

This is the rule book: every rule the app's numbers follow, in plain words, with its formula and one worked example.
Each rule has a number. The scenarios in `scenarios/*.feature` are tagged with the rules they test (`@A3`), and
`npm run scenarios` runs all of them on the app's own calculation code.

Three kinds of rule stand here:

- **A rule the app follows.** Its scenarios pass.
- **A rule the app does not follow.** That is a finding: it is listed in `scenarios/FINDINGS.md` with its scenario
  (tagged `@open`), and you decide what happens with it.
- **A rule that is decided and not built yet.** It is marked **Decided, not built** below, and its scenarios are
  tagged `@planned`. The run lists them until they are built.

Amounts are kept in cents. Nothing is rounded except where a rule says so.

The rules are grouped by letter: A amounts over the months, B balances, N net worth, P the months of the plan,
X other currencies, T the past, M the sums of a month, R rules, C loans and cards, V virtual accounts, O accounts
left out of net worth and pocket money, H schedules, K archiving, G people and goals, E the data. F and D are not
rules: they number the findings and the open decisions in `scenarios/FINDINGS.md`.

## A. An amount over the months

**A1. A month shows the amount typed in it.** The amount is kept to the cent, as typed. A negative amount is allowed
(a correction).

**A2. A month with nothing typed shows the amount of the month before.** Before a row's first amount, the row shows
nothing.

> "Rent" 1,200.00 typed in January: every month from January on shows 1,200.00.
> "Gym" 40.00 typed in April: January to March show nothing, April on shows 40.00.

**A3. "This and following months": the amount counts for this month and the months after it, whatever they held.**
The amount is saved in the month it is typed in, and the months after it follow by A2. A later month that had an
amount of its own (an amount typed there earlier, an exception, a list) loses it and follows too. Zero is an amount:
typed for this and the following months, the row stops there, also on a row that had no amount yet. Before saving,
the dialog names the months whose own amount goes.

> "Rent" is 1,200.00, and 1,300.00 from July on. Typed 1,250.00 in March, this and following months: January and
> February stay 1,200.00, March to December are 1,250.00.

Three things limit it:

- *Only a new amount replaces.* A month saved again with the amount it already handed on (to tick it, to change how
  sure it is, to add a note) leaves the months after it alone.
- *What is ticked as done stays.* A later month in which something is ticked as done keeps what it shows, as that
  month's alone (A4); the new amount goes on after it. The dialog names such a month too. Done is a record of what
  happened, and the plan is rewritten around it.
- *Where a month comes out of stays.* A later month whose amounts all come out of one source other than the row's
  own gets the new amount and keeps that source (the months before a source was changed "from June on" are stored
  this way): emptied, it would take the row's source of today, and the past balance of the old account would move.

> "Rent" is 1,200.00; July is 1,300.00 and ticked as done. Typed 1,250.00 in March, this and following months: March
> to June are 1,250.00, July stays 1,300.00, August on is 1,250.00.

A category's estimate follows the same rule, and so does a fixed amount set "from a month on" in the rule dialog
(R1). The change reaches the months this device holds: an amount typed on another device that had not synced yet
comes back with the next sync.

**A4. "Only this month": an exception of one month.** The month gets the amount, as that month's alone. The months
after it go on with the amount from before the exception, and nothing is written into them: they read that amount
where it was typed. An exception in a row's first month leaves the months after it empty.

> "Rent" is 1,200.00. Typed 1,250.00 in March, only this month: March is 1,250.00, April on is 1,200.00.
> "Clear" on April afterwards changes nothing: April holds nothing of its own.

An exception is an amount of its month like any other for A3: "this and following months" typed for an earlier month
replaces it, unless it is ticked as done.

The same holds for whatever the app writes for one month: an item added for one month (A6), a top-up of a virtual
account, a category's estimate for one month, a card's difference booked as spending, and the tick on a month that
only carried its amount: the month is written down as that month's alone.

One case writes a later month. An exception in the month an amount *began* leaves that amount to the months after:
it is written into the first later month that has nothing of its own.

> Typed 1,250.00 in March, this and following months, and then 1,300.00 in March, only this month: March is 1,300.00,
> April on is 1,250.00, and April now holds the 1,250.00.

A row on a schedule, a row a rule works out and a row that follows another have no exceptions of this kind: an
amount typed there is for its month alone by itself (H3, R6).

**A5. "Clear": the month follows the month before again.** What was typed in the month is gone, and A2 applies.

**A6. A month can be a list of items, and shows their sum.** An item added to a month that followed the month before
keeps that amount as the first item. Saved with "This and following months", the months after it show the sum as one
amount, and a new sum replaces what they held (A3); saved with "Only this month", they show what they showed before
(A4).

> "Rent" is 1,200.00. "Extra heating" 80.00 added in March, only this month: March is 1,280.00, April is 1,200.00.

## B. Balances from month to month

**B1. Every account starts a month with what it ended the month before.** In its first month it starts with its
opening amount. This holds in the account's own currency.

**B2. A savings account ends a month with: start + what went in − what came out.** In: the transfers to it, and the
rest of the month when the account takes it. Out: spending that comes out of it, and money taken out by hand.

> "Savings" holds 5,000.00 and gets 500.00 a month: January ends with 5,500.00, March with 6,500.00.

**B3. An investment grows every month by the twelfth root of its yearly growth.**

    growth per month = (1 + growth per year) ^ (1/12) − 1
    end of month     = (start + paid in − taken out) × (1 + growth per month), rounded to the cent

What is paid in joins at the start of the month and grows with it.

> 10,000.00 at 6 % a year: 0.4868 % a month. January ends with 10,048.68, February with 10,097.59, December with
> 10,600.00. With 200.00 paid in every month, January ends with 10,249.65.

**B4. The current accounts end a month with: start + what the month left.** What the month left is everything that
came in minus everything that went out. A month that costs more than comes in takes the difference from the current
accounts ("From the account"). When an account takes the rest of the month, the rest goes there and the current
accounts keep nothing; in a month that overruns, the difference comes back out of that account.

The plan knows the current accounts only together: one figure for all of them.

> Income 3,000.00, rent 1,200.00, current account 1,000.00: January leaves 1,800.00 and ends with 2,800.00.
> With "Savings" taking the rest: January ends with 1,000.00 in the current account and 6,800.00 in savings.

**B5. A real balance replaces the calculated one.** Typed under "Balances for <Month>…", it is the end of that month.
The next month starts from it (B1). The months before it do not change, and a later change in a month before it does
not reach past it.

> "Savings" is calculated at 5,500.00 for the end of January and really held 5,620.00: January ends with 5,620.00,
> February with 6,120.00. The 120.00 is the part "real balances" of that month's change in net worth (N2).

**B6. The current accounts take real balances only together.** Every current account that is open in the month
needs one. One alone is refused: the plan could not tell what the others held.

**B7. The start of a month is the end of the month before.** A real start typed for March is saved as the real end
of February. In an account's first month, the start is its opening amount.

**B8. Clearing a real balance brings the calculated one back.** The months after it follow.

> **Decided, not built (its own step).**
>
> **B9. A household has one main account, in the household's currency.** The month's money runs through it, and its
> real balance is one number. Any other everyday account is an account with a balance of its own that money is moved
> to. B6 goes away with it.

## N. Net worth

**N1. Net worth is what the household has, less what it owes.**

    net worth = current accounts + savings + investments + other assets − debts

Each at the end of the month, in the household's currency. An account marked "Leave out of net worth" is not counted.

**N2. A change in net worth is explained by named parts.** From the end of one month to the end of the next:

| Part | What it is | Sign |
| --- | --- | --- |
| income | what was earned: the income rows, without money taken out of own accounts | + |
| spending | what the month cost: the expense rows, whatever they came out of | − |
| pocket money | pocket money paid out | − |
| moved elsewhere | rows that "move money between your accounts" and name no account | − |
| growth | what the investments earned (B3) | + |
| rates | what a changed rate did to accounts in another currency (X6) | + or − |
| real balances | real balance minus calculated balance, for every balance typed that month (B5) | + or − |
| accounts starting or ending | the opening amount of an account that starts, the last balance of one that ends | + or − |
| accounts left out of net worth | money that went to, or came from, an account net worth does not count | − or + |
| money without an account | a transfer that names no account with a balance: the money is counted as gone | − |

A transfer between two accounts that are both counted is in none of these parts: one falls, the other rises.
Paying a loan down is in none of them either: the current account and the debt fall by the same amount.

> Income 3,000.00, rent 1,200.00, 500.00 a month to savings: net worth rises by 1,800.00 a month. Income 3,000.00,
> spending −1,200.00; the 500.00 only moved.
> In the household's first month the accounts start: with 1,000.00 and 5,000.00 opened, net worth rises by 7,800.00,
> of which 6,000.00 is "accounts starting or ending".

The app shows these parts nowhere yet. The scenario runner works them out by itself from the rows and the accounts'
settings, compares them with every balance the app calculated, and fails when a cent is left over.

A row that "moves money between your accounts" names the account that receives it: one with a balance of its own
(a savings account, an investment account, cash, an other asset). The amount leaves the current accounts and arrives
there, so it is in none of the parts above and net worth stays as it is. Only a row of that kind that names no such
account is "moved elsewhere": no account of the household receives the money, and net worth falls by it (finding F2,
closed).

## P. The months of the plan

**P1. The plan runs from the household's first month to a December.** This year's December; from October on, next
year's.

> In March 2026 a household that started in January 2026 is planned to December 2026. On 1 October 2026 the plan
> reaches December 2027.

**P2. "Add a year" adds one more year, and it stays.** Each press adds one year after the last one planned.

**P3. The plan reaches the December of the last month an amount was typed in.** So an amount typed for a far month
is never outside the plan.

An exception in the plan's last month is an amount in that month, and the plan keeps its end (finding F1, closed).
The one case of A4 that writes a later month reaches further: an amount that begins in the plan's last month and is
then made that month's alone begins in the month after, which is in the next year.

**P4. A new month changes nothing in the months before it.** When the calendar moves on, no amount and no balance of
an earlier month changes. A new year of the plan continues every row (A2) and every balance (B1).

## X. Other currencies

A rate is written as how many of the other currency one unit of the household's currency buys: EUR/USD 1.1000 means
one euro buys 1.10 dollars.

**X1. An amount in another currency counts at the rate of its month.** It is typed and kept in its own currency.

    counted in the household's currency = amount ÷ rate, rounded to the cent

> 3,300.00 USD at 1.1000 counts as 3,000.00 EUR; at 1.2500 as 2,640.00. 10.00 USD at 1.1000 counts as 9.09.

**X2. A month has one rate per currency.** A month without a rate of its own uses the nearest earlier month that has
one; before the first known month, the first known rate.

**X3. After the last known month, the last known rate stays.** A change per month can be set; then

    rate n months after the last known = last known rate × (1 + change per month) ^ n

> Last known 1.0000 in March, change 1 % a month: April 1.0100, May 1.0201.

Rule X12 replaces this once it is built.

**X4. A rate you set counts for its month instead of the ECB's.** A fetch does not overwrite it. Removing it leaves
the month without a rate of its own (X2) until the ECB rate is fetched again.

**X5. A rate never changes an amount in its own currency.** It only changes what the amount counts as.

**X6. An account in another currency keeps its balance in that currency.** B1 to B8 hold there. It is shown at the
rate of each month, so its worth in the household's currency moves with the rate: that is the part "rates" in N2.
Money moved into it arrives at the month's rate. A real balance is typed in the account's currency.

> 1,100.00 USD: worth 1,000.00 EUR at 1.1000 and 880.00 at 1.2500. Net worth changes by −120.00, all of it "rates".

**X7. Without any rate, an amount counts one to one, and the app warns that no rate is set.** With the currencies of
X13 that should not happen: each of them has a rate.

**X8. A changed rate of an earlier month changes that month and every balance after it.** Today without a question;
rule T4 will ask first.

**X9. Two other currencies are converted through the household's.** GBP to USD is GBP to EUR, then EUR to USD.

> **Decided, not built (step 4).**
>
> **X10. A transaction in another currency keeps its own conversion.** It has a foreign amount, a home amount and a
> rate; any two give the third. The rate comes from you, from the official rate of a day you choose, or from the two
> amounts. It stays until you change it: a new month rate does not touch it. When the foreign amount is corrected,
> the rate stays and the home amount follows.
>
> **X11. Until a conversion is recorded, an amount uses the official rate of its month.** The latest rate while the
> month is running, the rate of its last working day once it is over, the forecast for a month to come. An account in
> another currency is shown at the same rate.
>
> **X12. The forecast follows the recent trend, and the trend fades out.** The first month to come moves by the
> average change per month of the last 12 months; each month after that by 80 % of the step before. Per currency you
> can set your own change per month, or hold the rate.
>
>     +1 % a month on average, last known 1.0000: 1.0100, then 1.0181 (+0.8 %), then 1.0246 (+0.64 %)
>
> **X13. Fifteen currencies are offered:** EUR, USD, GBP, TRY, CAD, AUD, CHF, SEK, NOK, DKK, PLN, CZK, HUF, RON, ISK.
>
> **X14. A virtual account is kept in the currency of the savings account that holds it.** In a dollar savings
> account it is a dollar balance: what is set aside arrives in dollars at the month's rate, and what is paid out of
> it leaves in dollars. It can only be moved to a savings account in the same currency.
>
> **X15. No payment across three currencies.** An expense comes out of an account in the expense's own currency or
> in the household's. Anything else is refused, and the app says which two it accepts.

## T. The past

The past is every month before the current calendar month.

**T1. A change in an earlier month carries through every balance after it.** That follows from B1: nothing is frozen
unless a real balance stands in between (B5).

**T3. "Balances for <Month>…" is a button of its own**, with a tick "Count everything in <Month> as done". The tick
puts the done mark on every line of the month that has an amount, and changes no amount. It is set when the dialog
opens for a month that is over, and not for the current month or a later one. The balances and the ticks are saved
as one step.

**T2. No month is closed.** A month that is over can be corrected like any other, and what is in it can be deleted.
It counts as done only where it is ticked (T3). By itself the app fills only the current month and later (H5), so
the past changes only by your own hand. A month that an older version of the app had closed becomes, once, a month
with every line ticked: it keeps every amount, and a schedule that had no item of its own there stays left out.

> **Decided, not built (step 5).**
>
> **T4. A change that alters a past month asks first.** It lists the months and what changes in them, and offers
> "Cancel" and "Save anyway". Where a setting can have a date (the growth of an investment), it also offers "only
> from the current month on". A change in the current month or later is saved without a question. The app never
> changes the past by itself. A file that is merged shows the same list first: what it would change on this device.

## M. The sums of a month

**M1. What comes in is what goes out plus what is left.**

    what is left = income − expenses paid from the month − what goes to savings, investments, virtual accounts,
                   pocket money and loans − what a row moves to another account, or out of the plan

Both sides of the Statement's upper half show the same total. "Leftover" is what stays in the current accounts.

> Income 3,000.00, rent 1,200.00, groceries 450.00: 1,350.00 is left. With 500.00 to savings: 1,300.00 is left, and
> "From what is left" shows 1,800.00.

**M2. Money taken out of an account by hand comes in, and is not income.** It stands under "From accounts". A
percentage of the income (R2) does not count it. Net worth does not change: the account falls, the month has more.

**M3. What is deducted from an income lowers what it brings home.** The deduction (a tax, a contribution) is an
expense row of its own, and the income still shows in full. What the income "brings home" is the income minus its
deductions: that is what a percentage of the income and each person's income count.

> Salary 3,000.00, tax 600.00 deducted from it: income 3,000.00, brought home 2,400.00, and 10 % of the income is
> 240.00.

**M4. A row that follows another shows that row's amount times its share, every month.**

**M5. A category with an estimate counts the estimate, or its rows when they come to more.**

    not broken down yet = estimate − the category's rows, never below zero

> "Home" is estimated at 1,500.00 and holds rent of 1,200.00: the category counts 1,500.00. Estimated at 1,000.00,
> it counts 1,200.00.

**M6. An expense that comes out of an account is spending, and leaves the month's income alone.** It counts under
"Expenses", and the same amount stands under "From accounts". The account falls by it (B2), and net worth with it.

## R. Rules: how much goes where

The transfer to a savings account, an investment account or a virtual account, and an adult's pocket money, each
follow one rule.

**R1. A typed amount.** It carries from month to month like any amount (A2). Set "from a month on" in the rule
dialog, it replaces what was typed for the months after it, and a later month that is ticked as done keeps its
amount (A3).

**R2. A percentage of the income.** Of what the month's income brings home (M3), rounded to the cent.

> 10 % of 3,333.33 is 333.33.

**R3. A percentage of what is left.** What is left for these percentages is the income minus the expenses, the typed
amounts and the percentages of income (and minus what is kept in the current account, R5); never below zero.

> Income 3,000.00, rent 1,200.00, 10 % of the income to the index fund (300.00): 1,500.00 is left, and 50 % of it is
> 750.00. In a month that overruns, nothing is left to take a percentage of.

**R4. The rest.** One account takes whatever is left after everything else. In a month that overruns, the
difference comes back out of it. Giving the rest to another account takes it from the first.

**R5. What the household keeps in the current account every month comes off the rest.** It counts only while an
account takes the rest.

**R6. An amount typed into a month counts instead of the rule, for that month.** A rule starts in a month: the months
before it keep what they showed.

The order within a month: percentages of the income, what is kept, percentages of what is left, the rest.

## C. Loans and credit cards

**C1. A payment brings a loan down, and counts as an expense of the month.**

    owed at the end = owed at the start − paid

Net worth does not change: the current accounts and the debt fall by the same amount. The plan works out no
interest: a real balance says what is really owed (B5).

A payment stops at what is owed. The last one is what is still owed, and after it the payment counts as nothing: not
in the month's expenses, not in what is left, not in the current accounts. What was planned stays stored, so the
payments count again when a real balance says more is owed (finding F4, closed).

    owes 600.00, 250.00 planned a month: 250.00, 250.00, 100.00 count, then nothing
    several rows to one loan take what is owed in the Grid's order
    a loan in another currency is counted in that currency, so it ends on exactly nothing

Not cut: a loan whose balance is not tracked, a payment row that names no loan, the months before the loan starts,
and an amount below zero, which is money drawn again and raises what is owed.

**C2. A card whose purchases are expense rows.** A purchase is an expense of its month and raises what is owed. The
cash stays in the current accounts until the card is paid. The payment moves money and is no expense: the current
accounts and what is owed fall by it.

**C3. A card that records only its payments.** The payment is the month's expense, and nothing else: no row says
what was bought on the card, so no row moves what is owed on it. That stays as it is until a real balance is typed
for the card (rule B5), and net worth falls by each payment (finding F5, closed).

    owes 500.00, 300.00 paid every month: still 500.00 owed in every month
    a real balance of 200.00 in March: 200.00 from March on, and net worth is 300.00 higher that month

## V. Virtual accounts

**V1. A virtual account is a part of its savings account.** What is set aside goes from the month into the savings
account and is marked as the virtual account's.

    virtual account at the end = at the start + set aside − paid out
    not set aside              = the savings account's balance − its virtual accounts

Net worth counts the savings account once.

**V2. An expense that comes out of a virtual account lowers it and its savings account** (M6).

**V3. A virtual account is never below zero.** Asked for more than it holds, it stops at nothing; what is missing
comes out of the part of its savings account that is not set aside. Its line on the Statement changes by what its
balance changed by, which in such a month is less than what was asked of it (finding F6, closed).

**V4. A top-up.** From its savings account, money moves inside the account: the month takes it in and sets it aside
again, and what is left does not change. From the month's income, less is left.

## O. Accounts left out of net worth, and pocket money

**O1. An account left out of net worth keeps its balance, and no sum counts it.**

**O2. Pocket money leaves the household's net worth.** It is the part "pocket money" in N2.

**O3. Pocket money can land in an account that is left out of net worth, and only there.** Such an account cannot be
counted again while pocket money lands in it.

**O4. An expense paid out of an account that is left out costs the household's net worth nothing.** It is spending
of the month (M6); the part "accounts left out of net worth" in N2 is the same amount the other way.

**O5. Pocket money can be a percentage of what its adult brings home** (M3).

## H. Schedules

**H1. A row on a schedule gets its amount in the months the schedule lands in.** The months between are empty: a
scheduled row does not carry its amount forward (A2 does not apply to it).

> 300.00 every 3 months from February: February, May, August and November show 300.00, the other months nothing.

**H2. A row's first schedule keeps the amounts of the months before it.** They are written down, so they stay.
A schedule and what it lands in the months are saved as one step, wherever the schedule is made or changed: one undo
takes back both (finding F8, closed).

**H3. A scheduled amount can be changed for one month, or for that month and the following ones.** Changed for the
following months, a new amount or a new source replaces what a later month was given for itself ("Only this month"),
as A3 says for any amount; the dialog names those months before saving. What is ticked as done keeps what was paid,
and a month the item was left out of stays without it. Only a value that really changes replaces: a new rhythm by
itself undoes no one-month amount.

> "Rent" lands 1,300.00 every month; August is 1,500.00 for August alone. Changed to 1,400.00 in June, for this and
> the following months: June to December are 1,400.00. Had August been ticked as done, it would still be 1,500.00.

**H4. A schedule that is stopped lands for the last time in that month.**

**H5. A new year of the plan gets the schedule's amounts**, whether the calendar or "Add a year" brought it. By
itself the app fills the current month and the months after it. A month that is over is left as it is, with one
exception: a month the schedules never reached, because the app was not opened from before the plan grew to it
until after it ended, gets their amounts when the app is opened again.

**H7. A schedule changed in the list of schedules counts from the current month.** The list names no month, so a
new amount, source or rhythm starts in the current month, and the months before keep what they had; what was ticked
as paid keeps what was paid. A first or a last month is a month that was typed and counts as typed: the months
between the old one and the new one are filled or emptied. "Reactivate" runs a schedule again from the current
month. A schedule that ended in a month that is over has nothing left to change from here on: the form says so.

**H6. Items that repeat and items that do not can share a month.** The month shows their sum.

## K. Archiving and restoring

**K1. Something archived stops in a month and keeps its past.** An archived row shows nothing from that month on.
An archived account leaves net worth with what it held: the part "accounts starting or ending" in N2.

A row that followed the archived row (M4) stops following and keeps what it showed: in every month before, its
amounts, and nothing where it showed nothing. From that month on it goes on with the last amount it showed.

> "Service charge" follows "Rent" at 10%: 120.00 in January and February, nothing from March, when the rent ends.
> "Rent" archived from June: the service charge still shows 120.00, 120.00 and then nothing.

**K2. Restoring brings the thing back as it was.**

**K3. Restoring also brings back what archiving changed with it.** The archived thing keeps a note of what its
archive changed, and "Restore" puts that back in one step:

- a row: the schedules the archive ended run again, and the rows that followed it follow it again;
- a virtual account: its "To …" row fills it again, and what came out of it comes out of it again;
- an account: the virtual accounts archived with it are back, with their rows, and what came out of the account and
  of them comes out of them again.

Only what still shows what the archive left is put back. A schedule that was given another end since and a row that
was given another source since stay as they are; the app says how many. A virtual
account is not restored while its savings account is archived, nor a "To …" row while its virtual account is.
Something archived before the app kept this note comes back by itself (finding F7, closed).

## G. People and goals

**G1. Each adult brings home their own income, less what is deducted from it** (M3).

**G2. A goal is reached in the first month the plan meets its amount.** A goal the plan does not reach says so.

## E. The data

**E1. A file carries everything.** An empty app that imports it shows the same figures (check 9).

**E2. Merging the same file again changes nothing.**

**E3. Merging an older copy brings nothing old back.** The newer change wins, whether the copy is a file or the
other device's. That holds for what was removed too: something this device took back stays removed when a copy that
still holds it comes in, unless that copy was changed after the removal (finding F9, closed).

## The checks that always hold

After every step of every scenario the runner checks the whole plan, month by month. A scenario fails when one of
these does not hold, whatever the scenario is about.

1. **balanced**: both halves of the Statement balance in every month.
2. **sums**: every heading is the sum of the lines it counts.
3. **carried**: every account starts a month with what it ended the month before (B1); the Statement's lines agree
   from month to month; and a month reads the same when the app works out fewer months.
4. **adds-up**: the month's money adds up: what comes in is what goes out plus what is left.
5. **explained**: every account's month, and the change in net worth, is explained by the parts of N2.
6. **virtual-accounts**: a virtual account is never below zero.
7. **undo**: undo gives back the figures from before the last action, and redo brings it back.
8. **settled**: letting the app settle a second time changes nothing.
9. **round-trip**: exporting the data and importing it into an empty app gives the same figures.

Checks 7 and 9 run once, at the end of each scenario. The names are what a scenario's tag uses when an open finding
shows as a failing check (`@breaks-undo`).

## Running the scenarios

    npm run scenarios

It prints how many scenarios pass, the open findings with where each one fails, and the planned rules. The same
scenarios run with the unit tests, so every commit is checked against them.

- A scenario fails when a step is not understood, when a name in it does not exist, or when its setup fails. No tag
  excuses that.
- An `@open` scenario is expected to fail at the "Then" its finding is about. The day it passes, the run fails and
  says so: the finding is closed and the tag comes off.
- A `@planned` scenario is expected to fail. The day it passes, the run fails and says the tag can come off.
- A `@parked` scenario shows what the app does today in a case where the rule is still an open decision.

The scenario code is type-checked with the app (`npx tsc -b`).

Scenarios are written in the app's own words, for a made-up household: Sam and Alex.
