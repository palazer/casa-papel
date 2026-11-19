Feature: Real balances
  What an account really held, typed under "Balances for <Month>…", against what the plan worked out.
  Rules B5 to B8 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And a savings account "Savings" holding 5,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026
    And a transfer "To Savings" of 500.00 to "Savings" from January 2026

  @B5
  Scenario: A real balance replaces the calculated one, and the next month starts from it
    When "Savings" really held 5,620.00 at the end of January 2026
    Then "Savings" ends January 2026 with 5,620.00
    And "Savings" starts February 2026 with 5,620.00
    And "Savings" ends February 2026 with 6,120.00
    And net worth changes by 7,920.00 in January 2026
    And of that, 120.00 is "real balances"

  @B5
  Scenario: A real balance below the plan lowers net worth by the difference
    When "Savings" really held 5,400.00 at the end of February 2026
    Then "Savings" ends February 2026 with 5,400.00
    And net worth changes by 1,200.00 in February 2026
    And of that, -600.00 is "real balances"
    And nothing has changed before February 2026

  @B7
  Scenario: The start of a month is the end of the month before
    When "Savings" really held 5,700.00 at the start of February 2026
    Then "Savings" ends January 2026 with 5,700.00
    And "Savings" starts February 2026 with 5,700.00
    And "Savings" ends February 2026 with 6,200.00

  @B7
  Scenario: The start of an account's first month is its opening amount
    When "Savings" really held 4,000.00 at the start of January 2026
    Then "Savings" starts January 2026 with 4,000.00
    And "Savings" ends January 2026 with 4,500.00
    And net worth changes by 6,800.00 in January 2026
    And of that, 5,000.00 is "accounts starting or ending"

  @B7
  Scenario: A real start of a later month of the current account is the end of the month before
    When "Current account" really held 3,000.00 at the start of March 2026
    Then "Current account" ends February 2026 with 3,000.00
    And "Current account" starts March 2026 with 3,000.00
    And "Current account" ends March 2026 with 4,300.00
    And nothing has changed before February 2026

  @B5
  Scenario: Taking a real balance back restores the calculated one
    Given "Savings" really held 5,620.00 at the end of January 2026
    When I undo
    Then "Savings" ends January 2026 with 5,500.00
    And "Savings" ends December 2026 with 11,000.00

  @B5
  Scenario: Real balances travel with an export
    Given "Savings" really held 5,620.00 at the end of January 2026
    When I export the data and import it into an empty app
    Then "Savings" ends February 2026 with 6,120.00
    And nothing has changed

  @B8
  Scenario: Clearing a real balance brings the calculated one back
    Given "Savings" really held 5,620.00 at the end of January 2026
    When I clear the real balance of "Savings" at the end of January 2026
    Then "Savings" ends January 2026 with 5,500.00
    And "Savings" ends December 2026 with 11,000.00

  @B5
  Scenario: A real balance of the current account corrects what the plan kept
    When "Current account" really held 2,150.00 at the end of January 2026
    Then "Current account" ends January 2026 with 2,150.00
    And "Current account" starts February 2026 with 2,150.00
    And "Current account" ends February 2026 with 3,450.00
    And net worth changes by 7,650.00 in January 2026
    And of that, -150.00 is "real balances"

  @B9 @B5
  Scenario: The main account takes its own real balance, and another current account takes its own
    Given another current account "Joint account" holding 400.00
    When "Current account" really held 2,150.00 at the end of January 2026
    Then "Current account" ends January 2026 with 2,150.00
    And "Joint account" ends January 2026 with 400.00
    When "Joint account" really held 350.00 at the end of February 2026
    Then "Joint account" ends March 2026 with 350.00
    And "Current account" ends February 2026 with 3,450.00

  @B5
  Scenario: A real balance in a later month leaves the earlier months alone
    When "Savings" really held 9,000.00 at the end of June 2026
    Then "Savings" ends May 2026 with 7,500.00
    And "Savings" ends July 2026 with 9,500.00
    And nothing has changed before June 2026

  @B5
  Scenario: A changed amount in a month before a real balance does not reach past it
    Given "Savings" really held 6,000.00 at the end of February 2026
    When I type 900.00 for "To Savings" in January 2026, only this month
    Then "Savings" ends January 2026 with 5,900.00
    And "Savings" ends February 2026 with 6,000.00
    And "Savings" ends March 2026 with 6,500.00

  @B5
  Scenario: A real balance of an investment replaces what the growth worked out
    Given an investment account "Index fund" holding 10,000.00 that grows 6% a year
    When "Index fund" really held 9,500.00 at the end of January 2026
    Then "Index fund" ends January 2026 with 9,500.00
    And "Index fund" ends February 2026 with 9,546.24
    And net worth changes by 17,300.00 in January 2026
    And of that, 48.68 is "growth"
    And of that, -548.68 is "real balances"
