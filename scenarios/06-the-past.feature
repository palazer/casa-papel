Feature: The past
  The past is every month before the current one. No month is closed: a month that is over can still be corrected,
  and the app never changes it by itself. A change that reaches into the past asks first (the scenarios tagged @T4
  answer the question as the dialog does). Rules T1 to T4 of docs/calculations.md.

  Background:
    Given today is 15 June 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And a savings account "Savings" holding 5,000.00
    And an investment account "Index fund" holding 10,000.00 that grows 6% a year
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026
    And a transfer "To Savings" of 500.00 to "Savings" from January 2026

  @T1
  Scenario: A change in an earlier month carries through every balance after it
    When I type 1,500.00 for "Rent" in February 2026, only this month
    Then "Current account" ends January 2026 with 2,300.00
    And "Current account" ends February 2026 with 3,300.00
    And "Current account" ends June 2026 with 8,500.00
    And nothing has changed before February 2026

  @T1
  Scenario: A change in the current month leaves the past alone
    When I type 1,300.00 for "Rent" in June 2026, this and following months
    Then nothing has changed before June 2026

  # ---------- no month is closed ----------

  @T2
  Scenario: There is nothing to close: a month that is over can still be corrected
    When I type 1,250.00 for "Rent" in March 2026, only this month
    Then "Rent" is 1,250.00 in March 2026
    And no month can be closed or reopened

  @T2
  Scenario: A month that an older version of the app had closed counts as done and keeps its amounts
    When the app opens data in which an older version had closed March 2026
    Then every amount of March 2026 is done
    And nothing has changed
    And "Rent" can still be changed in March 2026
    And no month can be closed or reopened

  @T2
  Scenario: A month that was closed stays as it was when the calendar moves on
    Given the app opens data in which an older version had closed March 2026
    When the calendar moves on to October 2026
    Then every amount of March 2026 is done
    And nothing has changed before January 2027

  @T2
  Scenario: Something with amounts in months that are over can be deleted
    When I delete the row "Rent"
    Then the Statement of March 2026 has no line "Rent"
    And "Current account" ends January 2026 with 3,500.00

  @T2
  Scenario: A rule can start in a month that is over
    When "Savings" gets 10% of the income from March 2026
    Then "To Savings" is 300.00 in March 2026
    And "To Savings" is 500.00 in February 2026
    And nothing has changed before March 2026

  @T3
  Scenario: "Count everything as done" marks a whole month done, and changes no amount
    When I count everything in May 2026 as done
    Then every amount of May 2026 is done
    And nothing has changed

  @T3
  Scenario: Real balances are typed without closing anything
    When I open "Balances for May 2026" and type 7,650.00 for "Savings"
    Then "Savings" ends May 2026 with 7,650.00
    And "Rent" can still be changed in May 2026

  @T3
  Scenario: Counting a month as done leaves a balance that was typed for it as it is
    Given "Savings" really held 7,650.00 at the end of April 2026
    When I count everything in April 2026 as done
    Then every amount of April 2026 is done
    And nothing has changed

  @T3
  Scenario: A month that is counted as done leaves the months around it as they were
    When I count everything in May 2026 as done
    Then every amount of May 2026 is done
    And "Rent" can still be changed in May 2026
    And "Rent" is 1,200.00 in every month from January 2026 to December 2026

  # ---------- step 5: the question before a change alters the past ----------

  @T4
  Scenario: A change that reaches into past months asks first, and says which months
    When I type 1,300.00 for "Rent" in March 2026, this and following months
    Then I am asked before it is saved, with March 2026, April 2026 and May 2026 listed
    And nothing has changed

  @T4
  Scenario: "Cancel" leaves everything as it was
    Given I type 1,300.00 for "Rent" in March 2026, this and following months
    When I answer the question about the past with "Cancel"
    Then "Rent" is 1,200.00 in every month from January 2026 to December 2026

  @T4
  Scenario: "Save anyway" changes the past months that were listed
    Given I type 1,300.00 for "Rent" in March 2026, this and following months
    When I answer the question about the past with "Save anyway"
    Then "Rent" is 1,300.00 in every month from March 2026 to December 2026
    And "Rent" is 1,200.00 in February 2026

  @T4
  Scenario: A change in the current month or later is saved without a question
    When I type 1,300.00 for "Rent" in June 2026, this and following months
    Then I am not asked anything
    And "Rent" is 1,300.00 in June 2026

  @T4
  Scenario: A changed growth rate does not change the past without asking
    When I change the yearly growth of "Index fund" to 12%
    Then nothing has changed before June 2026

  @T4 @planned
  Scenario: A growth rate can be changed from the current month on only
    When I change the yearly growth of "Index fund" to 12%, only from the current month on
    Then "Index fund" ends May 2026 with 10,245.76
    And "Index fund" ends June 2026 with 10,342.98
    And nothing has changed before June 2026

  @T4
  Scenario: A rate set for a past month asks first
    Given an income "Alex – Salary" in USD of 3,300.00 from January 2026
    And the ECB rate for EUR/USD in January 2026 is 1.1000
    When I set my rate for EUR/USD in February 2026 to 1.2000
    Then I am asked before it is saved, with February 2026, March 2026, April 2026 and May 2026 listed
