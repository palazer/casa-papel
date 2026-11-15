# Findings

Where the app's numbers differ from a rule of `docs/calculations.md`. Each finding has a scenario that shows it
(tagged `@open` and with the finding's number), so `npm run scenarios` lists it until it is closed. Nothing here is
fixed on the side: you decide each one, and a fix is its own step.

To close a finding: write the decision under it, change the app or the rule, and take `@open` off its scenario. The
run fails the day an `@open` scenario passes, so a finding cannot stay listed by mistake.

## Open findings

### F1. An exception in the plan's last month lengthens the plan by a year

- **What the app does.** The plan runs to December 2026. Type an amount for December 2026 with "Only this month":
  twelve more months appear, and the plan runs to December 2027. The same happens when an item is added to
  December with "Only this month".
- **Why.** To keep an exception to one month, the app writes the old amount into the month after it (rule A4), here
  January 2027. The plan reaches the December of the last month an amount was typed in (rule P3), and it takes that
  written amount for a typed one.
- **What the rule says.** P3 is about amounts you typed. An exception typed for December is an amount in December.
- **Scenarios.** `04-plan-and-calendar.feature`: "An exception in the plan's last month does not lengthen the plan",
  "An item added to the plan's last month only does not lengthen the plan".
- **Options.** (a) Decide it with step 3, where "Only this month" and "This and following months" are reworked: an
  exception kept as a mark on its own month writes nothing into the next one, which also closes F3. (b) Fix it alone
  now: the amount an exception writes does not count for the plan's length. (c) Leave it: an extra year is shown,
  no figure is wrong.
- **Recommendation.** (a).
- **Decision.**

### F2. Money "moved between your accounts" lowers net worth

- **What the app does.** A row added as "Moves money between your accounts" names no account. Its amount goes out of
  the month under "Moved elsewhere", the current accounts end lower by it, and no account ends higher. Net worth
  falls by the amount, every month. With 300.00 a month, net worth is 3,600.00 lower after a year.
- **What the rule says.** Money that only moves between the household's own accounts changes nothing in net worth
  (rule N2).
- **Scenario.** `02-balances-month-to-month.feature`: "Money moved between the household's own accounts leaves net
  worth as it is".
- **To be fair to the app.** If the money goes to an account the plan keeps no balance for, falling net worth is what
  the plan can know. But the row's own words say the money stays yours, and its help says "It is not spending".
- **Options.** (a) Such a row says which account receives the money; with an account that has a balance, net worth
  holds. (b) Keep the row as it is and say what it does: "Leaves the plan", with a line that net worth falls by it.
  (c) Leave it.
- **Recommendation.** (a), with (b)'s wording for a row that names no account.
- **Decision.**

### F3. The month after an exception holds an amount nobody typed

- **What the app does.** "Rent" is 1,200.00; March gets 1,250.00 with "Only this month". April shows 1,200.00, as it
  should. But April now has an amount of its own, written by the app (rule A4). Two things follow:
  - "Clear" on April removes it. April then follows March (rule A5) and shows 1,250.00, and so does every month
    after it: the exception has become the new amount.
  - Typing an amount for March again with "Every month" stops at April, which keeps its 1,200.00, and so do the
    months after it. The second half is covered by the decided rule for step 3 (its scenario is listed as planned).
- **What the rule says.** An exception lasts one month, whatever is done to the months around it next (rule A4).
- **Scenario.** `01-amounts-over-months.feature`: "The month after an exception has nothing of its own to clear".
- **Options.** (a) Decide it with step 3: an exception is a mark on its own month, and the next month holds nothing.
  (b) Leave it.
- **Recommendation.** (a).
- **Decision.**

## Decided, not built yet

These are rule changes you decided in November 2026. Their scenarios are tagged `@planned`; the run lists each one
with the place it fails today.

| Step | Rule | Scenarios |
| --- | --- | --- |
| 2. Closing replaced by the calendar | T2, T3 | `06-the-past.feature`: 3 |
| 3. "This and following months" | A3 | `01-amounts-over-months.feature`: 2 |
| 4. The currency model | X10 to X13 | `05-rates.feature`: 9 |
| 5. The question before a change alters the past | T4 | `06-the-past.feature`: 7 |

One of them already shows what the app does today: a changed growth rate of an investment changes every past month
without a question ("A changed growth rate does not change the past without asking").

## Open decisions

Cases where no rule is decided yet. A scenario tagged `@parked` shows what the app does today, so a later decision
has something to change.

- **D1. A virtual account inside a savings account in another currency.** The virtual account is kept in the
  household's currency while its account is not. No scenario yet (virtual accounts come with the second delivery).
- **D2. A current account in another currency.** The plan knows the current accounts only together, in the
  household's currency. Today its opening amount is converted once, when it opens, and a later rate does not move
  it; a real balance is converted at its own month's rate, and the difference shows as "not in the plan".
  Scenario: `05-rates.feature`, "A current account in another currency is converted when it opens, and not again".
- **D3. An expense in a third currency paid from an account in another currency.** No scenario yet.
- **D4. A month whose rate is missing.** Today the amount counts one to one, with a warning.
  Scenario: `05-rates.feature`, "An amount in a currency without any rate is counted one to one".
- **D5. Changing the household's own currency.** Not possible today.

## Looked at and found sound

What the first delivery ran and found no fault with. Every scenario also ran the nine checks after each of its steps
(the list is at the end of `docs/calculations.md`), and none of them failed.

- An amount over the months: typed, carried, an exception, an exception typed twice, two in a row, zero, a negative
  amount, clearing, items, undo.
- Balances: what a month leaves, a month that overruns, a transfer to savings, an account that takes the rest (also
  from a later month, and in a month that overruns), an investment's growth with and without deposits, an account
  that opens later.
- Real balances: above and below the plan, at the start and at the end of a month, cleared, of the current account,
  of an investment, in another currency, with two current accounts, taken back, exported and imported.
- The plan: its last month through the year, "Add a year" once and twice and from October on, the calendar moving
  into a new month and into a new plan year.
- Rates: an amount at its month's rate, rounding, a month without a rate, the months after the last known rate, a
  rate you set and remove, an account in another currency, money moved into one, two other currencies.
- Net worth: its change is explained to the cent in every month of every scenario, apart from F2.

## Still to look at

The second delivery covers the month's sums, rules and the rest, virtual accounts, cards and loans, accounts left out
of net worth and pocket money, schedules, people and goals, and the data round trip. The research pointed at these,
which are not proven yet:

- A card that records only its payments falls with each payment and never rises.
- Restoring something archived does not bring back what archiving changed.
- Undoing a schedule added from the list may leave later months at 0.
- A virtual account that was short: the Statement's change for it may not match its balances.
- The demo household is fixed to autumn 2026 and ages with the calendar.
