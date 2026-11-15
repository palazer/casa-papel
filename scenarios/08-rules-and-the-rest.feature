Feature: Rules: how much goes where
  A typed amount, a percentage of the income, a percentage of what is left, and the rest.
  Rules R1 to R6 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And a savings account "Savings" holding 5,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026

  @R1
  Scenario: A typed amount goes to the account every month
    Given an investment account "Index fund" holding 0.00
    When "Index fund" gets 200.00 a month from January 2026
    Then "Index fund" ends January 2026 with 200.00
    And "Index fund" ends December 2026 with 2,400.00
    And "Current account" ends January 2026 with 2,600.00

  @R2
  Scenario: A percentage of the income
    Given an investment account "Index fund" holding 0.00
    When "Index fund" gets 10% of the income from January 2026
    Then "Index fund" ends January 2026 with 300.00
    And "Current account" ends January 2026 with 2,500.00

  @R2
  Scenario: A percentage is rounded to the cent
    Given an investment account "Index fund" holding 0.00
    And I type 3,333.33 for "Sam – Salary" in January 2026, every month
    When "Index fund" gets 10% of the income from January 2026
    Then "Index fund" ends January 2026 with 333.33
    And "Index fund" ends February 2026 with 666.66

  @R2
  Scenario: A percentage follows the income when it changes
    Given an investment account "Index fund" holding 0.00
    And "Index fund" gets 10% of the income from January 2026
    When I type 4,000.00 for "Sam – Salary" in March 2026, every month
    Then "Index fund" ends February 2026 with 600.00
    And "Index fund" ends March 2026 with 1,000.00

  @R3
  Scenario: A percentage of what is left comes after spending and the percentages of income
    Given an investment account "Index fund" holding 0.00
    And a savings account "Holiday fund" holding 0.00
    When "Index fund" gets 10% of the income from January 2026
    And "Holiday fund" gets 50% of what is left from January 2026
    Then "Index fund" ends January 2026 with 300.00
    And "Holiday fund" ends January 2026 with 750.00
    And "Current account" ends January 2026 with 1,750.00

  @R2 @B3
  Scenario: What a rule pays into an investment grows with it from the first month
    Given an investment account "Index fund" holding 0.00 that grows 5% a year
    When "Index fund" gets 10% of the income from January 2026
    Then the Statement of January 2026 shows "To Index fund" at 300.00
    And "Index fund" ends January 2026 with 301.22

  @R3
  Scenario: A month that overruns leaves nothing to take a percentage of
    Given a savings account "Holiday fund" holding 0.00
    And "Holiday fund" gets 50% of what is left from January 2026
    When I type 3,500.00 for "Rent" in February 2026, only this month
    Then "Holiday fund" ends January 2026 with 900.00
    And "Holiday fund" ends February 2026 with 900.00
    And "Current account" ends February 2026 with 1,400.00

  @R4
  Scenario: The rest is what is left after everything else
    Given a savings account "Holiday fund" holding 0.00
    When "Holiday fund" gets 25% of what is left from January 2026
    And "Savings" takes the rest of the month from January 2026
    Then "Holiday fund" ends January 2026 with 450.00
    And "Savings" ends January 2026 with 6,350.00
    And "Current account" ends January 2026 with 1,000.00

  @R4
  Scenario: One account takes the rest: giving it to another takes it from the first
    Given a savings account "Holiday fund" holding 0.00
    And "Savings" takes the rest of the month from January 2026
    When "Holiday fund" takes the rest of the month from March 2026
    Then "Savings" ends February 2026 with 8,600.00
    And "Savings" ends March 2026 with 8,600.00
    And "Holiday fund" ends March 2026 with 1,800.00
    And nothing has changed before March 2026

  @R5
  Scenario: What the household keeps in the current account comes off the rest
    Given "Savings" takes the rest of the month from January 2026
    When the household keeps 200.00 in the current account every month from January 2026
    Then "Current account" ends January 2026 with 1,200.00
    And "Savings" ends January 2026 with 6,600.00
    And "Current account" ends February 2026 with 1,400.00

  @R6
  Scenario: An amount typed into a month counts instead of the rule, for that month
    Given "Savings" takes the rest of the month from January 2026
    When I type 500.00 for "To Savings" in February 2026, only this month
    Then "Savings" ends February 2026 with 7,300.00
    And "Current account" ends February 2026 with 2,300.00
    And "Savings" ends March 2026 with 9,100.00

  @R6
  Scenario: A rule that starts later leaves the typed amounts before it
    Given a transfer "To Savings" of 500.00 to "Savings" from January 2026
    When "Savings" gets 10% of the income from March 2026
    Then "Savings" ends February 2026 with 6,000.00
    And "Savings" ends March 2026 with 6,300.00
    And nothing has changed before March 2026

  @R1
  Scenario: A rule cannot start before the household does
    When "Savings" takes the rest of the month from December 2025
    Then it is refused with "a rule cannot start before that"
