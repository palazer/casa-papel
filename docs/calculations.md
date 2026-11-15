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

Covered so far (first delivery): amounts over the months, balances from month to month, real balances, net worth,
the months of the plan, other currencies, the past. Still to come: the month's sums, rules and the rest, virtual
accounts, cards and loans, accounts left out of net worth and pocket money, schedules, people and goals, the data
round trip.

## A. An amount over the months

**A1. A month shows the amount typed in it.** The amount is kept to the cent, as typed. A negative amount is allowed
(a correction).

**A2. A month with nothing typed shows the amount of the month before.** Before a row's first amount, the row shows
nothing.

> "Rent" 1,200.00 typed in January: every month from January on shows 1,200.00.
> "Gym" 40.00 typed in April: January to March show nothing, April on shows 40.00.

**A3. "Every month": the amount counts for this month and the months after it.** The amount is saved in the month it
is typed in. The months after it follow by A2, up to the next month that has an amount of its own. Zero is an amount
too: typed for every month, the row stops there.

> "Rent" is 1,200.00. Typed 1,250.00 in March, every month: January and February stay 1,200.00, March on is 1,250.00.

What the app does today: a later month that has its own amount keeps it, and so do the months after that one.

> **Decided, not built (step 3).** The choice is called "This and following months", and it replaces whatever the
> following months had: an amount typed there earlier, and an exception.

**A4. "Only this month": an exception of one month.** The month gets the amount. The month after it shows what it
showed before. An exception in a row's first month leaves the months after it empty.

> "Rent" is 1,200.00. Typed 1,250.00 in March, only this month: March is 1,250.00, April on is 1,200.00.

How the app does it today: it writes the old amount into the next month, unless that month has an amount of its own
already. Two findings follow from that: F1 (the plan grows by a year) and F3 ("Clear" on the next month).

**A5. "Clear": the month follows the month before again.** What was typed in the month is gone, and A2 applies.

**A6. A month can be a list of items, and shows their sum.** An item added to a month that followed the month before
keeps that amount as the first item. Saved with "Every month", the months after it show the sum as one amount; saved
with "Only this month", they show what they showed before (A4).

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

Finding F2 belongs here: "moved elsewhere" lowers net worth although the row says the money stays the household's.

## P. The months of the plan

**P1. The plan runs from the household's first month to a December.** This year's December; from October on, next
year's.

> In March 2026 a household that started in January 2026 is planned to December 2026. On 1 October 2026 the plan
> reaches December 2027.

**P2. "Add a year" adds one more year, and it stays.** Each press adds one year after the last one planned.

**P3. The plan reaches the December of the last month an amount was typed in.** So an amount typed for a far month
is never outside the plan.

Finding F1 belongs here: an exception in the plan's last month counts as an amount typed in the month after it.

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

**X7. Without any rate, an amount counts one to one.** The app warns. Whether that is right is open decision D4.

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

## T. The past

**T1. A change in an earlier month carries through every balance after it.** That follows from B1: nothing is frozen
unless a real balance stands in between (B5).

> **Decided, not built (steps 2 and 5).**
>
> The past is every month before the current calendar month.
>
> **T2. Closing and reopening a month go away.** A month that is over can still be corrected.
>
> **T3. "Balances for <Month>…" is a button of its own**, with a tick "Count everything in <Month> as done". The
> tick changes no amount.
>
> **T4. A change that alters a past month asks first.** It lists the months and what changes in them, and offers
> "Cancel" and "Save anyway". Where a setting can have a date (the growth of an investment), it also offers "only
> from the current month on". A change in the current month or later is saved without a question. The app never
> changes the past by itself.

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

Scenarios are written in the app's own words, for a made-up household: Sam and Alex.
