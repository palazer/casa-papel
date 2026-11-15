Feature: Accounts left out of net worth, and pocket money
  Money that is a person's own. Rules O1 to O5 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And a savings account "Savings" holding 5,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026

  @O1
  Scenario: An account left out of net worth keeps its balance, and net worth does not count it
    When "Savings" is left out of net worth
    Then "Savings" ends January 2026 with 5,000.00
    And net worth is 2,800.00 at the end of January 2026

  @O1
  Scenario: Counting the account again brings net worth back
    Given "Savings" is left out of net worth
    When "Savings" is counted in net worth again
    Then net worth is 7,800.00 at the end of January 2026

  @O2
  Scenario: Pocket money leaves the household's net worth
    Given pocket money "Sam – Pocket" for "Sam" of 200.00 from January 2026
    Then the Statement of January 2026 shows "Leftover" at 1,600.00
    And net worth changes by 1,600.00 in February 2026
    And of that, -200.00 is "pocket money"

  @O3
  Scenario: Pocket money can land in an account that is left out of net worth
    Given a savings account "Sam's pocket" holding 100.00
    And "Sam's pocket" is left out of net worth
    And pocket money "Sam – Pocket" for "Sam" of 200.00 from January 2026
    When "Sam – Pocket" lands in "Sam's pocket"
    Then "Sam's pocket" ends January 2026 with 300.00
    And "Sam's pocket" ends March 2026 with 700.00
    And net worth is 7,600.00 at the end of January 2026
    And net worth changes by 1,600.00 in February 2026

  @O3
  Scenario: Pocket money cannot land in an account that net worth counts
    Given pocket money "Sam – Pocket" for "Sam" of 200.00 from January 2026
    When "Sam – Pocket" lands in "Savings"
    Then it is refused with "Pocket money can only land in an account that is left out of net worth."

  @O3
  Scenario: An account cannot be counted again while pocket money lands in it
    Given a savings account "Sam's pocket" holding 100.00
    And "Sam's pocket" is left out of net worth
    And pocket money "Sam – Pocket" for "Sam" of 200.00 from January 2026
    And "Sam – Pocket" lands in "Sam's pocket"
    When "Sam's pocket" is counted in net worth again
    Then it is refused with "pocket money can only land in an account that is left out of net worth"

  @O4
  Scenario: An expense paid out of an account that is left out costs the household's net worth nothing
    Given a savings account "Sam's pocket" holding 1,000.00
    And "Sam's pocket" is left out of net worth
    And an expense "Bike" with no amount yet
    And "Bike" comes out of "Sam's pocket" in every month
    When I type 400.00 for "Bike" in February 2026, only this month
    Then "Sam's pocket" ends February 2026 with 600.00
    And the Statement of February 2026 shows "Expenses" at 1,600.00
    And net worth changes by 1,800.00 in February 2026
    And of that, -1,600.00 is "spending"
    And of that, 400.00 is "accounts left out of net worth"

  @O5
  Scenario: Pocket money as a percentage of the adult's own income
    Given pocket money "Sam – Pocket" for "Sam"
    And "Sam – Salary" belongs to "Sam"
    And an income "Alex – Salary" of 2,000.00 from January 2026
    And "Alex – Salary" belongs to "Alex"
    When "Sam – Pocket" gets 5% of their own income from January 2026
    Then "Sam – Pocket" is 150.00 in January 2026
    And "Sam" brings home 3,000.00 in January 2026
    And "Alex" brings home 2,000.00 in January 2026
