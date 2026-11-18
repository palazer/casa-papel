Feature: Balances from month to month
  Where the month's money ends up, and how every account carries it into the next month.
  Rules B1 to B4 and N1, N2 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026

  @B4
  Scenario: What a month leaves stays in the current account
    Then the Statement of January 2026 shows "Leftover" at 1,800.00
    And "Current account" starts January 2026 with 1,000.00
    And "Current account" ends January 2026 with 2,800.00
    And "Current account" starts February 2026 with 2,800.00
    And "Current account" ends December 2026 with 22,600.00

  @B4
  Scenario: A month that costs more than comes in takes it from the current account
    When I type 4,000.00 for "Rent" in February 2026, only this month
    Then the Statement of February 2026 shows "From the account" at 1,000.00
    And "Current account" ends February 2026 with 1,800.00
    And "Current account" ends March 2026 with 3,600.00

  @B2
  Scenario: A transfer to a savings account moves money, and net worth stays the same
    Given a savings account "Savings" holding 5,000.00
    And a transfer "To Savings" of 500.00 to "Savings" from January 2026
    Then "Savings" ends January 2026 with 5,500.00
    And "Savings" starts February 2026 with 5,500.00
    And "Savings" ends March 2026 with 6,500.00
    And "Current account" ends January 2026 with 2,300.00
    And net worth changes by 1,800.00 in February 2026
    And of that, 3,000.00 is "income"
    And of that, -1,200.00 is "spending"

  @B1 @N1
  Scenario: Net worth is what the household has, less what it owes
    Given a savings account "Savings" holding 5,000.00
    Then net worth is 7,800.00 at the end of January 2026
    And net worth is 9,600.00 at the end of February 2026
    And the Statement of February 2026 shows "Net worth" at 9,600.00

  @N2
  Scenario: The first month's change in net worth is what the accounts opened with and what the month left
    Given a savings account "Savings" holding 5,000.00
    Then net worth changes by 7,800.00 in January 2026
    And of that, 6,000.00 is "accounts starting or ending"
    And of that, 3,000.00 is "income"
    And of that, -1,200.00 is "spending"

  @B1
  Scenario: An account opened later starts with its opening amount in that month
    Given a savings account "Holiday fund" holding 2,000.00, opened in June 2026
    Then "Holiday fund" starts June 2026 with 2,000.00
    And net worth changes by 3,800.00 in June 2026
    And of that, 2,000.00 is "accounts starting or ending"
    And the Statement of May 2026 has no line "Holiday fund"

  @B2 @A3
  Scenario: Changing a transfer from a month on leaves the balances before it alone
    Given a savings account "Savings" holding 5,000.00
    And a transfer "To Savings" of 500.00 to "Savings" from January 2026
    When I type 800.00 for "To Savings" in June 2026, every month
    Then "Savings" ends May 2026 with 7,500.00
    And "Savings" ends June 2026 with 8,300.00
    And "Savings" ends December 2026 with 13,100.00
    And nothing has changed before June 2026

  @B3
  Scenario: An investment grows every month by the twelfth root of its yearly growth
    Given an investment account "Index fund" holding 10,000.00 that grows 6% a year
    Then "Index fund" ends January 2026 with 10,048.68
    And "Index fund" ends February 2026 with 10,097.59
    And "Index fund" ends December 2026 with 10,600.00
    And net worth changes by 1,848.91 in February 2026
    And of that, 48.91 is "growth"

  @B3
  Scenario: A deposit joins the investment at the start of the month and grows with it
    Given an investment account "Index fund" holding 10,000.00 that grows 6% a year
    And a transfer "To Index fund" of 200.00 to "Index fund" from January 2026
    Then "Index fund" ends January 2026 with 10,249.65
    And "Current account" ends January 2026 with 2,600.00
    And net worth changes by 12,849.65 in January 2026
    And of that, 11,000.00 is "accounts starting or ending"
    And of that, 49.65 is "growth"

  @B3
  Scenario: An investment without growth only moves by what goes in and out
    Given an investment account "Index fund" holding 10,000.00
    And a transfer "To Index fund" of 200.00 to "Index fund" from January 2026
    Then "Index fund" ends December 2026 with 12,400.00

  # A row that "moves money between your accounts" names the account that receives it. The money leaves the
  # current account and arrives there: net worth is what it was.
  @N2 @F2
  Scenario: Money moved to another of the household's accounts leaves net worth as it is
    Given a cash account "Wallet" holding 150.00
    And a row "To Wallet" that moves 300.00 to "Wallet" from January 2026
    Then "Wallet" ends January 2026 with 450.00
    And "Wallet" ends February 2026 with 750.00
    And "Current account" ends January 2026 with 2,500.00
    And the Statement of January 2026 shows "To Wallet" at 300.00
    And the Statement of January 2026 shows "From what is left" at 1,800.00
    And the Statement of January 2026 shows "Leftover" at 1,500.00
    And net worth changes by 1,800.00 in February 2026
    And of that, 0.00 is "moved elsewhere"

  @N2 @F2
  Scenario: Money can be moved into a savings account, an investment account or an other asset the same way
    Given a savings account "Savings" holding 5,000.00
    And an investment account "Index fund" holding 10,000.00
    And an other asset "Loan to Kim" worth 0.00
    And a row "Extra to Savings" that moves 100.00 to "Savings" from January 2026
    And a row "Extra to Index fund" that moves 200.00 to "Index fund" from January 2026
    And a row "Lent to Kim" that moves 50.00 to "Loan to Kim" from January 2026
    Then "Savings" ends January 2026 with 5,100.00
    And "Index fund" ends January 2026 with 10,200.00
    And "Loan to Kim" ends February 2026 with 100.00
    And the Statement of January 2026 shows "Leftover" at 1,450.00
    And net worth changes by 1,800.00 in February 2026

  # A row of the same kind that names no account: nothing of the household's receives the money.
  @N2 @F2
  Scenario: A row that moves money and names no account takes it out of the plan
    Given a row "To grandma" that moves 300.00 out of the plan from January 2026
    Then the Statement of January 2026 shows "Moved elsewhere" at 300.00
    And the Statement of January 2026 shows "Leftover" at 1,500.00
    And "Current account" ends January 2026 with 2,500.00
    And net worth changes by 1,500.00 in February 2026
    And of that, -300.00 is "moved elsewhere"

  # The account is one that net worth leaves out: the money arrives there, and net worth no longer counts it.
  @N2 @O1 @F2
  Scenario: Money moved into an account that net worth leaves out lowers net worth
    Given a cash account "Sam's wallet" holding 0.00
    And "Sam's wallet" is left out of net worth
    And a row "To Sam's wallet" that moves 300.00 to "Sam's wallet" from January 2026
    Then "Sam's wallet" ends February 2026 with 600.00
    And net worth changes by 1,500.00 in February 2026
    And of that, -300.00 is "accounts left out of net worth"

  @N2 @F2
  Scenario: A move cannot name an account without a balance of its own
    Given a savings account "Old savings" that is only named
    When a row "To old savings" that moves 300.00 to "Old savings" from January 2026
    Then it is refused with "no balance of its own"

  @B2 @B4
  Scenario: An account that takes the rest of the month gets what the month leaves
    Given a savings account "Savings" holding 5,000.00
    When "Savings" takes the rest of the month from January 2026
    Then the Statement of January 2026 shows "To Savings" at 1,800.00
    And "Savings" ends January 2026 with 6,800.00
    And "Current account" ends January 2026 with 1,000.00
    And "Savings" ends December 2026 with 26,600.00

  @B2 @B4
  Scenario: A rule that starts in a later month leaves the months before it as they were
    Given a savings account "Savings" holding 5,000.00
    When "Savings" takes the rest of the month from March 2026
    Then "Savings" ends February 2026 with 5,000.00
    And "Current account" ends February 2026 with 4,600.00
    And "Savings" ends March 2026 with 6,800.00
    And "Current account" ends March 2026 with 4,600.00
    And nothing has changed before March 2026

  @B2 @B4
  Scenario: A month that costs more than comes in takes the difference back out of the account that takes the rest
    Given a savings account "Savings" holding 5,000.00
    And "Savings" takes the rest of the month from January 2026
    When I type 4,000.00 for "Rent" in February 2026, only this month
    Then "Savings" ends January 2026 with 6,800.00
    And "Savings" ends February 2026 with 5,800.00
    And "Current account" ends February 2026 with 1,000.00
    And net worth changes by -1,000.00 in February 2026
    And of that, -4,000.00 is "spending"

  @N2
  Scenario: Taking a transfer back restores every balance
    Given a savings account "Savings" holding 5,000.00
    And a transfer "To Savings" of 500.00 to "Savings" from January 2026
    When I type 0.00 for "To Savings" in January 2026, every month
    Then "Savings" ends December 2026 with 5,000.00
    And "Current account" ends January 2026 with 2,800.00
