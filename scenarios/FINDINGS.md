# Findings

Where the app's numbers differ from a rule of `docs/calculations.md`. Each finding has a scenario that shows it
(tagged `@open` and with the finding's number), so `npm run scenarios` lists it until it is closed. Nothing here is
fixed on the side: you decide each one, and a fix is its own step.

To close a finding: write the decision under it, change the app or the rule, and take `@open` off its scenario. The
run fails the day an `@open` scenario passes, so a finding cannot stay listed by mistake. A closed finding keeps its
text and its scenario keeps the finding's number: the scenario is what stops it from coming back.

| | Finding | Weighs | Recommendation | State |
| --- | --- | --- | --- | --- |
| F1 | An exception in the plan's last month lengthens the plan by a year | small | with step 3 | closed; one case is left, and says so |
| F2 | Money "moved between your accounts" lowers net worth | net worth is wrong | the row names the account that receives it | closed |
| F3 | The month after an exception holds an amount nobody typed | amounts can change by surprise | with step 3 | closed |
| F4 | A loan that is paid off keeps taking payments | net worth is right, the debt reads below zero | the payment stops at what is owed | closed |
| F5 | A card that records only its payments never lowers net worth | net worth is wrong | payments do not move what is owed | closed |
| F6 | The Statement's change for a virtual account that ran short | one figure on the Statement | show the change of the balance | closed |
| F7 | Restoring does not bring back what archiving changed with it | amounts stay changed | restore puts it back | closed |
| F8 | Undo of a schedule added from the list empties the row's months | amounts are lost | save the schedule and its months as one step | closed |
| F9 | Merging an older copy (a file, or the other device's) brings back what was taken back | an undone change returns | the merge respects what this device removed | closed; the file comparison comes with step 5 |
| F10 | A row that followed another shows amounts it never had once that row is archived | months that are over change | write the 0.00 down | closed |
| F11 | A schedule deleted after a payment: the paid amount runs on into every later month | amounts appear that nobody planned | what was paid is that month's alone | closed |
| F12 | A schedule made in the list of schedules is read in the household's currency | an amount 100 times too large, for a currency without cents | the form reads the amount in the row's currency | closed |
| F13 | A row moved to a currency without cents multiplies its amounts by 100 | every month of the row is wrong | the amounts keep their digits | closed |

## The findings

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
- **Closed** (18 November 2026). "Only this month" is a mark on its own month (`Cell.once`): the month shows its
  amount and hands on what it was given, so nothing is written into January and the plan keeps its end. The same
  holds for an item added for one month, a top-up, a category's estimate for one month and a card's difference
  booked as spending.
- **What is left.** One case still writes the month after: an amount that *begins* in a month ("1,250.00 from
  December on") and is then made that month's alone ("December is 1,300.00, only this month"). The 1,250.00 has to
  begin somewhere, so it begins in January, and the plan then reaches into the next year. The figures are the ones
  asked for. Scenario: "An exception in the month an amount began, in the plan's last month, reaches into the next
  year".

### F2. Money "moved between your accounts" lowers net worth

- **What the app does.** A row added as "Moves money between your accounts" names no account. Its amount goes out of
  the month under "Moved elsewhere", the current accounts end lower by it, and no account ends higher. Net worth
  falls by the amount, every month. With 300.00 a month, net worth is 3,600.00 lower after a year.
- **What the rule says.** Money that only moves between the household's own accounts changes nothing in net worth
  (rule N2).
- **Scenarios.** `02-balances-month-to-month.feature`: "Money moved to another of the household's accounts leaves
  net worth as it is", "Money can be moved into a savings account, an investment account or an other asset the same
  way", "A row that moves money and names no account takes it out of the plan", "Money moved into an account that
  net worth leaves out lowers net worth", "A move cannot name an account without a balance of its own";
  `05-rates.feature`: "Money moved into an account in another currency arrives at the month's rate".
- **To be fair to the app.** If the money goes to an account the plan keeps no balance for, falling net worth is what
  the plan can know. But the row's own words say the money stays yours, and its help says "It is not spending".
- **Options.** (a) Such a row says which account receives the money; with an account that has a balance, net worth
  holds. (b) Keep the row as it is and say what it does: "Leaves the plan", with a line that net worth falls by it.
  (c) Leave it.
- **Recommendation.** (a), with (b)'s wording for a row that names no account.
- **Decision.** Yes (17 November 2026): the row names the account that receives the money; a row that names none says that the money leaves the plan.
  Any account with a balance of its own can be named (savings, investments, cash, other assets). A row that names
  one stands under "From what is left" with its link; "Moved elsewhere" keeps what names none.
- **Closed** (18 November 2026). "Moves money between your accounts" has a list of the accounts with a balance; the
  amount leaves the current accounts and arrives in the one that is named, at the month's rate when that account is
  in another currency, and net worth stays as it is. The row stands under "From what is left", linked to its account
  ("Goes into Wallet"). The list starts with "No account: the money leaves the plan": that row stands under "Moved
  elsewhere" with the mark "leaves the plan", and net worth falls by it, as before. The row menu's dialog says "Goes
  into" and offers the same list. Current accounts are not in it: they are one balance today, and join with the
  main-account step. One thing changed for stored data: a row of this kind that already noted an account "for your
  overview" sends its amount there from now on, when that account has a balance.

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
- **Closed** (18 November 2026). The month after an exception holds nothing: "Clear" finds nothing to clear there.
  And an amount typed for an earlier month with "Every month" no longer stops at the month after an exception: it
  replaces what the following months held (rule A3; scenario "An amount for the following months, typed before an
  exception, replaces the exception and reaches past it"). Exceptions made by an earlier version keep the amount
  that version wrote into the month after: such a pair cannot be told from two amounts that were typed, and no
  figure is wrong.

### F4. A loan that is paid off keeps taking payments

- **What the app does.** A loan of 600.00 with a payment of 250.00 a month owes 100.00 after February, −150.00 after
  March and −2,400.00 after December. The payment row runs on, and the debt reads as money the household has.
- **What still holds.** Net worth is right in total: the current accounts are lower by exactly what the "debt" is
  below zero. What is wrong is where the money shows, and that the month's expenses include a payment nobody makes.
- **What the rule says.** A debt is paid down to nothing, not below (rule C1).
- **Scenarios.** `09-loans-and-cards.feature`: "A loan that is paid off owes nothing, and not less than nothing",
  "The last payment to a loan is what is still owed, and after it the payment counts as nothing", "A real balance
  that raises what is owed makes the payments count again", "Two payments to one loan take what is owed in their
  order", "Changing a payment that was cut keeps what was planned in the other months"; `05-rates.feature`: "The
  last payment to a loan in another currency is what is still owed, at that month's rate".
- **Options.** (a) The payment stops at what is owed: the last payment is what is left of the debt, and the months
  after it show no payment. (b) The payment stays as typed and the app warns in the month the loan is paid off.
  (c) Leave it.
- **Recommendation.** (a).
- **Decision.** Yes (17 November 2026): the payment stops at what is owed. It stops by itself and is marked; the
  row is not ended, so what was planned stays.
- **Closed** (18 November 2026). A payment to a loan counts up to what is still owed: 250.00, 250.00, 100.00, then
  nothing. The month's expenses, what is left, the current accounts and net worth use what counts. The Statement
  marks the row "paid off" with what was planned beside it, the row's dialog says why, and the list of schedules
  says "paid off" where it would say "due". What was planned stays stored, so a real balance that says more is owed
  makes the payments count again. Not cut: a loan whose balance is not tracked, a payment row that names no loan,
  the months before the loan starts, and an amount below zero (money drawn again, which raises what is owed). The
  loan form asks for what is owed while the balance is tracked. The checks got one more: rows never take a loan
  below nothing.

### F5. A card that records only its payments never lowers net worth

- **What the app does.** For such a card the payment is the month's expense, and the Statement shows it under
  "Expenses": that part is right. But every payment also brings down what is owed, and nothing ever raises it,
  because purchases are not recorded. A card that owed 500.00 and is paid 300.00 a month owes −3,100.00 after a
  year. And since the current accounts and the "debt" fall together, the spending never reaches net worth: it is
  300.00 a month too high.
- **What the rule says.** What is spent lowers net worth (rule N2), and a debt is not below zero (rule C3).
- **Scenarios.** `09-loans-and-cards.feature`: "What is spent through a card that records only its payments lowers
  net worth", "What is owed on a card that records only its payments stays until a real balance says otherwise"
  (it was called "…does not fall below zero" and expected 0.00, which is not what was decided), "A real balance
  says what is owed on a card that records only its payments".
- **Options.** (a) A payment to such a card does not move what is owed: it pays for what was bought since the last
  payment. What is owed stays as it is until a real balance says otherwise, and net worth falls by the payment.
  (b) Leave it, and rely on real balances to correct the card.
- **Recommendation.** (a).
- **Decision.** Yes (17 November 2026): a payment to such a card does not move what is owed.
- **Closed** (17 November 2026). A payment to such a card is the month's spending and nothing else: what is owed
  stays as it is until a real balance is typed for the card, and net worth falls by the payment. On the Statement
  the payment's link reads "Paid to Amex", the card's line links back with "Payments: …" and carries the note
  "changes with real balances only". The forms say the same.

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
- **Closed** (17 November 2026). A virtual account's line changes by its balance at the end of the month minus its
  balance at the start. "Not set aside", "Set aside" and "Free" are worked out from it and follow. In the example
  the line now says −200.00 and "Not set aside" takes the other 300.00.

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
- **Decision.** Yes (17 November 2026): archiving remembers what it changed, and restoring puts it back. After the
  press a short message says what came back, with "Undo".
- **Closed** (18 November 2026). An archived row, virtual account or account keeps a note of what its archive
  changed: the schedules it ended, the rows that followed, what was archived with it, and what came out of it and was
  moved elsewhere. "Restore" puts all of that back in one step: a row's schedules run again and its followers follow
  again; a virtual account's "To …" row fills it again; an account's virtual accounts are back, and what came out of
  it and of them comes out of them again. A message at the foot of the window says what came back and what stayed
  (`Restored "Rent": its schedule "Rent" runs again.`), with "Undo".
  - Whatever was changed between the archive and the restore stays: a schedule goes back only if it still ends
    where the archive ended it, and a source only where it still shows what the archive set. The message counts those ("1 thing you changed since stays as it is.").
  - A virtual account whose savings account is still archived is not restored by itself, and neither is the "To …"
    row of an archived virtual account: the app says which one to restore.
  - The note travels with the record, so a restore works on a second device and years later. This is a new stored
    field (schema 14): a device on an older version of the app is asked to reload before it syncs again.
  - Something archived before this change has no note. Restoring it brings back the thing itself, and the message
    says so.

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
- **Closed** (17 November 2026). A schedule that is added, changed, ended or reactivated in the list is saved together
  with what it lands in the row's months, so one undo takes back both. A row made in the same form ("New row…") is
  part of the step too.

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
- **Decision.** Fix now, compare later (17 November 2026): the merge respects what this device removed, for files
  and for sync. When step 5 has its list of what a change alters, a file shows that list before it is merged.
- **Closed** (17 November 2026), for the merge. A record that comes in and is not on this device is looked up in the
  device's own history: if it was removed here and the copy was not changed after that, it stays removed. A copy that
  was changed after the removal comes in, because the newest still wins. Two things make the comparison hold: a
  removal is never dated before the record it removes, and whatever a device writes after a removal is dated after
  it (so an amount taken back and put back again reaches the other device). Still to come, with step 5: a file shows
  what it would change before it is merged (scenario "A file shows what it would change before it is merged").

### F10. A row that followed another shows amounts it never had once that row is archived

Found on 18 November 2026 while step 3 was built; older than that step.

- **What the app does.** "Service charge" follows "Rent" at 10%. Rent is 1,200.00 in January and February and
  0.00 from March on, so the service charge is 120.00, 120.00 and then 0.00. Archive "Rent" from June: the service
  charge now shows 120.00 in every month, March to May included, which are over and showed 0.00.
- **Why.** A row that stops following keeps what it showed as amounts of its own. A month in which it showed
  nothing gets nothing written, so that month carries the amount before it (rule A2).
- **What the rule says.** Something archived keeps its past (K1), and the app does not change a month that is over
  by itself (T2, P4).
- **Scenario.** `13-archive-and-restore.feature`: "A row that followed another keeps showing nothing where it
  showed nothing".
- **Options.** (a) Write the 0.00 down where the row showed nothing after an amount: the row keeps exactly what it
  showed. (b) Leave it.
- **Recommendation.** (a). A small change in one place (`pinFollowers`).
- **Decision.** Yes (18 November 2026): as recommended.
- **Closed** (18 November 2026). A row that stops following because the row it followed is archived keeps what it
  showed in every month before the archive: where it showed nothing after an amount, the 0.00 is written down, and
  so it is where the row still held an amount of its own from before it followed. From the archive on it goes on
  with the last amount it showed, which can be nothing.
- **Put right in this record.** The finding first said "archived or deleted". Deleting is not affected: there the
  row stops following and keeps its *own* amounts, as the dialog says, not the ones it showed.
- **What is left.** From the archive month on the row is its own again. An amount it held for a later month from
  before it followed shows there again; the dialog's sentence ("keeps the last amount as its own from <Month>")
  does not mention that case.

### F11. A schedule deleted after a payment: the paid amount runs on into every later month

Found on 18 November 2026 while step 3 was built; older than that step.

- **What the app does.** "Insurance" lands 600.00 once a year, in February, and February is ticked as done. Delete
  the schedule ("All occurrences" → "Delete"): February keeps its 600.00, as it should. But March shows 600.00
  too, and so does every month after it.
- **Why.** A row on a schedule never carries an amount forward (H1). Without its last schedule the row is an
  ordinary row again, and an ordinary row carries the last amount it holds (A2): here the payment that was kept.
  Ending a schedule after a month does not do this, because the schedule stays on the row.
- **What the rule says.** A schedule that is stopped lands for the last time in that month (H4). Deleting it takes
  away what it posted and was not paid; nothing says it adds amounts.
- **Scenario.** `12-schedules.feature`: "A schedule that is deleted leaves no amounts after what was paid".
- **Options.** (a) When a row's last schedule is deleted, what it keeps as paid becomes that month's alone (the
  mark step 3 added for exceptions), so nothing carries on from it. (b) Deleting a schedule that has payments is
  refused, with "End after <Month>" offered instead. (c) Leave it.
- **Recommendation.** (a). The paid months stay as they are and no later month changes its amount by surprise.
- **Decision.** Yes (18 November 2026): as recommended.
- **Closed** (18 November 2026). When a row's last schedule is deleted, every month the row holds keeps what it
  holds as that month's alone, so nothing starts running on and the row shows what it showed, less the postings
  the deletion takes away. That is a little wider than "what it keeps as paid": an item typed beside the schedule
  ("Late fee" 15.00 in March) ran on in the same way and is covered too, and so are the amounts the row had before
  its first schedule. While another schedule stays on the row nothing is marked: the row still carries nothing.
  Two things came with it: the row's dialog, when the last schedule is deleted from inside it, turns the line that
  carried the month before's amount into an item with that amount (it would have been saved as worth nothing);
  and a month that holds only the empty list a deleted schedule left is not named as "what you typed" when a
  later amount for the following months replaces it.
- **What is left.** A schedule that was deleted before this fix: what it left as paid still runs on. Type 0.00 for
  the month after it, for this and the following months.

### F12. A schedule made in the list of schedules is read in the household's currency

Found on 18 November 2026 while step 4 was planned; older than that step.

- **What the app does.** A row is in Icelandic krónur, a currency without cents. Under Household, "Add schedule"
  for that row and type 25000: the row shows 2,500,000 kr a month. The field is labelled "Amount (EUR)" whatever the
  row is in, and the list of schedules shows the amount with the household's currency.
- **Why.** An amount is stored in its currency's smallest unit. The form read what was typed as euros (2,500,000
  cents), and the row reads that number as krónur. For a currency with cents both readings give the same number,
  so only the label and the list were wrong there.
- **What the rule says.** An amount is typed and kept in its row's currency (X1).
- **Scenario.** `05-rates.feature`: "A schedule made in the list of schedules is read in its row's currency"; the
  form itself in the browser test "a schedule for a row in a currency without cents is read and shown in that
  currency".
- **Decision.** Fix with step 4, part 1 (18 November 2026).
- **Closed** (18 November 2026). The form reads, labels and shows the amount in the currency of the row it is for,
  and the list of schedules shows it in that currency.

### F13. A row moved to a currency without cents multiplies its amounts by 100

Found on 18 November 2026 while step 4 was planned; older than that step.

- **What the app does.** "Summer house" is 1,000.00 euros a month. Change the row to ISK, in its menu or in its
  dialog: every month it holds reads 100,000 kr, though the dialog says "numbers already typed keep their digits".
  Changed in the dialog of a month with "This and following months", the month itself is right (1,000 kr), the
  months before it are 100 times too large, and a later month with an amount of its own loses it.
- **Why.** The stored number (100000 cents) was read again in the new currency's smallest unit. The dialog rescaled
  only the month on screen, and the save then compared that month's new figure with the old ones, took the change
  of currency for a new amount and replaced the later months.
- **What the rule says.** A rate never changes an amount in its own currency (X5); the dialog's own sentence says
  the digits stay.
- **Scenarios.** `05-rates.feature`: "A row moved to a currency without cents keeps its digits in every month",
  "The same in the row's dialog: a later month keeps its own amount", "And back to a currency with cents", "A
  schedule of the row keeps its digits too".
- **Decision.** Fix with step 4, part 1 (18 November 2026).
- **Closed** (18 November 2026). When a row's currency changes to one that counts other decimals, the amounts of its
  months and of its schedules are written again in the new unit, in the same step as the change, so one Undo takes
  all of it back. A month that keeps a currency of its own is left alone. Half a króna rounds: 1,200.50 becomes
  1,201 kr. Between two currencies with cents nothing is rewritten.

## Decided, not built yet

These are rule changes you decided in November 2026. Their scenarios are tagged `@planned`; the run lists each one
with the place it fails today.

| Step | Rule | Scenarios |
| --- | --- | --- |
| 5. The question before a change alters the past | T4 | `06-the-past.feature`: 7, `14-people-goals-data.feature`: 1 |
| One main account (its own step) | B9 | `15-main-account.feature`: 2 |

One of them already shows what the app does today: a changed growth rate of an investment changes every past month
without a question ("A changed growth rate does not change the past without asking").

## What was open, and what you decided

Decided on 17 November 2026. D1, D2 and D3 are rules now (X14, B9 and X15 in `docs/calculations.md`). D1 and D3
are built since 18 November 2026 (step 4, part 2); D2 is not built yet, and its scenarios are tagged `@planned`.

- **D1. A virtual account inside a savings account in another currency.** Decided: allowed, and kept in that
  currency. A virtual account takes the currency of the savings account that holds it: in a dollar savings account
  it is a dollar balance. What is set aside arrives in dollars at the month's rate, and what is paid out of it
  leaves in dollars. Moving a virtual account to another savings account needs the same currency. Built on
  18 November 2026; a virtual account that sat in such an account before keeps the digits of its opening balance,
  read in that currency now (your choice). Corrected on 17 November 2026: it was first written down here as "not
  allowed", which was not what you said.
- **D2. A current account in another currency, and several current accounts.** Decided: one main account, always in
  the household's currency. The month's money runs through it, and its real balance is one number. Any other
  everyday account is an account with a balance of its own that money is moved to. It is a step of its own, with a
  question for households that have several current accounts today. Until it is built, `05-rates.feature` keeps the
  scenario of today's behaviour: "A current account in another currency is converted when it opens, and not again".
- **D3. An expense in a third currency paid from an account in another currency.** Decided: not allowed for now. An
  expense comes out of an account in the expense's own currency or in the household's; anything else is refused and
  says so. Payments across three currencies stay parked. Built on 18 November 2026 for every amount that moves an
  account (rule X15); amounts stored across three currencies before it keep counting as they did.
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
- Rates: an amount at its month's rate, rounding, a month without a rate, a rate you set and take back, an account
  in another currency, money moved into one, two other currencies. Since step 4, part 1: the official rate by day
  (the latest while a month runs, its last working day once it is over, the first days of a month, a second look
  that changes nothing), the forecast (the trend and its fading, less than a year of rates, a change of your own, a
  rate held, a rate typed for a month to come), the fifteen currencies, and a currency without cents.
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
