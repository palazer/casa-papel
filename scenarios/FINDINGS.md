# Findings

Where the app's numbers differ from a rule of `docs/calculations.md`. Each finding has a scenario that shows it
(tagged `@open` and with the finding's number), so `npm run scenarios` lists it until it is closed. Nothing here is
fixed on the side: you decide each one, and a fix is its own step.

To close a finding: write the decision under it, change the app or the rule, and take `@open` off its scenario. The
run fails the day an `@open` scenario passes, so a finding cannot stay listed by mistake.

| | Finding | Weighs | Recommendation |
| --- | --- | --- | --- |
| F1 | An exception in the plan's last month lengthens the plan by a year | small | with step 3 |
| F2 | Money "moved between your accounts" lowers net worth | net worth is wrong | the row names the account that receives it |
| F3 | The month after an exception holds an amount nobody typed | amounts can change by surprise | with step 3 |
| F4 | A loan that is paid off keeps taking payments | net worth is right, the debt reads below zero | the payment stops at what is owed |
| F5 | A card that records only its payments never lowers net worth | net worth is wrong | payments do not move what is owed |
| F6 | The Statement's change for a virtual account that ran short | one figure on the Statement | show the change of the balance |
| F7 | Restoring does not bring back what archiving changed with it | amounts stay changed | restore puts it back |
| F8 | Undo of a schedule added from the list empties the row's months | amounts are lost | save the schedule and its months as one step |
| F9 | Merging an older copy (a file, or the other device's) brings back what was taken back | an undone change returns | the merge respects what this device removed |

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
- **Decision.** Yes (17 November 2026): settled with step 3.

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
- **Decision.** Yes (17 November 2026): the row names the account that receives the money; a row that names none says that the money leaves the plan.

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
- **Decision.** Yes (17 November 2026): settled with step 3.

### F4. A loan that is paid off keeps taking payments

- **What the app does.** A loan of 600.00 with a payment of 250.00 a month owes 100.00 after February, −150.00 after
  March and −2,400.00 after December. The payment row runs on, and the debt reads as money the household has.
- **What still holds.** Net worth is right in total: the current accounts are lower by exactly what the "debt" is
  below zero. What is wrong is where the money shows, and that the month's expenses include a payment nobody makes.
- **What the rule says.** A debt is paid down to nothing, not below (rule C1).
- **Scenario.** `09-loans-and-cards.feature`: "A loan that is paid off owes nothing, and not less than nothing".
- **Options.** (a) The payment stops at what is owed: the last payment is what is left of the debt, and the months
  after it show no payment. (b) The payment stays as typed and the app warns in the month the loan is paid off.
  (c) Leave it.
- **Recommendation.** (a).
- **Decision.** Yes (17 November 2026): the payment stops at what is owed.

### F5. A card that records only its payments never lowers net worth

- **What the app does.** For such a card the payment is the month's expense, and the Statement shows it under
  "Expenses": that part is right. But every payment also brings down what is owed, and nothing ever raises it,
  because purchases are not recorded. A card that owed 500.00 and is paid 300.00 a month owes −3,100.00 after a
  year. And since the current accounts and the "debt" fall together, the spending never reaches net worth: it is
  300.00 a month too high.
- **What the rule says.** What is spent lowers net worth (rule N2), and a debt is not below zero (rule C3).
- **Scenarios.** `09-loans-and-cards.feature`: "What is spent through a card that records only its payments lowers
  net worth", "What is owed on a card that records only its payments does not fall below zero".
- **Options.** (a) A payment to such a card does not move what is owed: it pays for what was bought since the last
  payment. What is owed stays as it is until a real balance says otherwise, and net worth falls by the payment.
  (b) Leave it, and rely on real balances to correct the card.
- **Recommendation.** (a).
- **Decision.** Yes (17 November 2026): a payment to such a card does not move what is owed.

### F6. The Statement's change for a virtual account that ran short

- **What the app does.** A virtual account holds 200.00 and is asked for 500.00. It ends with nothing, and the
  missing 300.00 comes out of the rest of its savings account: all of that is right (rule V3). But its line on the
  Statement says it changed by −500.00, and "Not set aside" under the same account is off by 300.00 the other way.
  The two cancel, so every sum above them is right.
- **What the rule says.** A line's change is what its balance changed by (check "carried").
- **Scenario.** `10-virtual-accounts.feature`: "A virtual account that is asked for more than it holds stops at
  nothing". Its steps pass; it fails at the check.
- **Options.** (a) Show the change of the balance (−200.00), and the 300.00 on "Not set aside". (b) Leave it.
- **Recommendation.** (a).
- **Decision.** Yes (17 November 2026): the Statement shows the change of the balance.

### F7. Restoring does not bring back what archiving changed with it

- **What the app does.** Archiving something also settles what depended on it. Restoring puts only the thing itself
  back:
  - A row on a schedule: archiving ends its schedule. After restoring, the row is there and empty from the archive
    month on.
  - A virtual account: archiving also archives its "To …" row. After restoring, nothing is set aside any more.
  - An account that an expense came out of: archiving makes that expense come out of the month's income. After
    restoring, it still does.
- **What still works.** A plain row, and an account that took the rest of the month, come back exactly as they were.
- **What the rule says.** Restoring brings back what archiving changed with it (rule K3).
- **Scenarios.** `13-archive-and-restore.feature`: "A restored row gets its schedule back", "A restored virtual
  account is filled again", "A restored account pays again what came out of it".
- **Options.** (a) Archiving remembers what it changed, and restoring puts it back. (b) Restoring stays as it is,
  and its dialog lists what does not come back. (c) Leave it.
- **Recommendation.** (a).
- **Decision.** Yes (17 November 2026): archiving remembers what it changed, and restoring puts it back.

### F8. Undo of a schedule added from the list empties the row's months

- **What the app does.** "Rent" is 1,200.00 a month. In the list of schedules, "Add schedule…" puts 1,300.00 a month
  on it from March. Undo: "Rent" shows nothing from March on, where it should show 1,200.00 again.
- **Why.** Adding the schedule is the step that undo takes back. Putting its amounts into the months is done by the
  app right after, and is not part of that step. After the undo the app empties the months it had filled, and an
  emptied month does not follow the month before any more.
- **What still works.** The same schedule made in the row's own dialog ("Repeats") is undone correctly: there the
  months are part of the step.
- **What the rule says.** Undo gives back the figures from before the last action (check "undo").
- **Scenario.** `12-schedules.feature`: "Taking back a schedule that was added from the list of schedules restores
  the row".
- **Options.** (a) "Add schedule…" in the list saves the schedule and its months as one step, as the row's dialog
  does. (b) Take "Add schedule…" out of the list: schedules are made in the row's dialog. (c) Leave it.
- **Recommendation.** (a); (b) if the list is no longer where you make schedules.
- **Decision.** Yes (17 November 2026): the list saves the schedule and its months as one step.

### F9. Merging an older copy brings back what was taken back

- **What the app does.** Type 1,300.00 for "Rent" in March, export a file, undo. "Rent" is 1,200.00 again. Choose
  the file and "Merge into this device": "Rent" is 1,300.00 in March.
- **The same with two devices that sync.** Device A types the amount, device B receives it and changes something of
  its own. A takes its amount back before it has taken in B's copy. At the next sync A takes in B's copy, and the
  amount is back, on both devices. Tried on the merge the sync engine calls; when A's undo reaches B first, all is
  well.
- **Why.** Undo of something new removes it. The merge keeps the newer of two versions, but for something this
  device no longer holds it has nothing to compare with, and takes the incoming one. It does not look at its own
  record of having removed it.
- **What still works.** An amount that was changed (not newly typed) keeps the newer version. Merging the same file
  twice changes nothing. "Replace everything here" restores a file exactly as it was exported.
- **What the rule says.** Merging an older copy brings nothing old back (rule E3).
- **Scenarios.** `14-people-goals-data.feature`: "Merging an older file does not bring back what was taken back",
  "On two devices, an amount that was taken back does not return through the other device".
- **Options.** (a) The merge respects what this device removed: something removed here after the incoming version
  was written stays removed. Needed for sync whatever happens to files. (b) Besides (a), a file shows what it would
  change before it is merged, and you merge or cancel. (c) A file only restores: "Merge into this device" goes, and
  devices share through sync. (d) Leave it.
- **Recommendation.** (a) now; (b) once step 5 has the list of what a change alters, which is the same list.
- **Decision.** Being talked through (17 November 2026).

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

## What was open, and what you decided

Decided on 17 November 2026. D1 and D3 are rules now (X14, X15 in `docs/calculations.md`), not built yet: their
scenarios are tagged `@planned`.

- **D1. A virtual account inside a savings account in another currency.** Decided: not allowed. A virtual account is
  in the same currency as the savings account that holds it, so it is refused in a savings account in another
  currency, and the app says to make a savings account in that currency first. Moving a virtual account to another
  savings account needs the same currency too. (A virtual account is kept in the household's currency today, so this
  means: only in savings accounts in the household's currency.)
- **D2. A current account in another currency, and several current accounts.** Open. Your direction: one current or
  main account, always in the household's currency; that the plan knows several only together is the problem.
  Scenario of today's behaviour: `05-rates.feature`, "A current account in another currency is converted when it
  opens, and not again".
- **D3. An expense in a third currency paid from an account in another currency.** Decided: not allowed for now. An
  expense comes out of an account in the expense's own currency or in the household's; anything else is refused and
  says so. Payments across three currencies stay parked.
- **D4. A month whose rate is missing.** Decided: as today. The amount counts one to one, and the app warns that no
  rate is set. With the fifteen currencies of X13 every one has a rate. It is rule X7 now, no open decision.
- **D5. Changing the household's own currency.** Decided: stays impossible for now. Later perhaps a way to move a
  household to another currency.

## Looked at and found sound

What ran without a fault. Every scenario also ran the nine checks after each of its steps (the list is at the end of
`docs/calculations.md`); apart from the findings above, none of them failed.

- An amount over the months: typed, carried, an exception, an exception typed twice, two in a row, zero, a negative
  amount, clearing, items, undo.
- Balances: what a month leaves, a month that overruns, a transfer to savings, an account that takes the rest (also
  from a later month, and in a month that overruns), an investment's growth with and without deposits, an account
  that opens later.
- Real balances: above and below the plan, at the start and at the end of a month, cleared, of the current account,
  of an investment, of a loan, in another currency, with two current accounts, taken back, exported and imported.
- The plan: its last month through the year, "Add a year" once and twice and from October on, the calendar moving
  into a new month and into a new plan year.
- Rates: an amount at its month's rate, rounding, a month without a rate, the months after the last known rate, a
  rate you set and remove, an account in another currency, money moved into one, two other currencies.
- The month's sums: income, expenses and what is left, money taken out of an account by hand, deductions, a row that
  follows another, a category's estimate under and over its rows, an expense straight out of savings.
- Rules: a typed amount, a percentage of the income and its rounding, a percentage of what is left, the rest, the
  rest moving to another account, what is kept in the current account, a typed month beside a rule, a rule that
  starts later.
- Loans and cards: a loan paid down, a card whose purchases are expense rows, its payment.
- Virtual accounts: setting aside, spending from one, a top-up from the account and from the income, a percentage
  of the income.
- Accounts left out of net worth and pocket money: leaving out and counting again, pocket money, where it lands and
  where it may not, an expense out of an account that is left out, a percentage of an adult's own income.
- Schedules: every three months, once a year, on a row that carried an amount, changed for one month and from a
  month on, stopped, in a new plan year, beside a one-off item, undone when made in the row's dialog.
- Archiving: a row, an account, a plain row and an account that takes the rest restored.
- People, goals and data: what each adult brings home, a goal reached and not reached, export and import of a
  household with a virtual account, a schedule, a real balance and a rule, merging the same file, merging an older
  one.
- Net worth: its change is explained to the cent in every month of every scenario; a transfer to an account that is
  only named shows as "money without an account".

## Not looked at yet

- The demo household is fixed to autumn 2026 and ages with the calendar (the browser tests now run on a fixed day,
  so they no longer depend on it).
- Sync between two devices (see F9).

## The same stories in the browser

`e2e/stories.spec.ts` runs five of the scenarios through the screens, with the same household and the same numbers:
what a month leaves, an exception and undo, a real balance, an account that takes the rest, and percentage rules.
They check that the dialogs save what the scenarios' steps save. One difference showed and is not a fault: the
account form starts a new investment account at 5 % growth a year, where a scenario's investment account grows only
when the scenario says so.
