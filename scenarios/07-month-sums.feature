Feature: The sums of a month
  What comes in, what goes out, and what is left. Rules M1 to M6 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And a savings account "Savings" holding 5,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026

  @M1
  Scenario: What comes in is what goes out plus what is left
    Given an expense "Groceries" of 450.00 from January 2026
    Then the Statement of January 2026 shows "Income" at 3,000.00
    And the Statement of January 2026 shows "Expenses" at 1,650.00
    And the Statement of January 2026 shows "Leftover" at 1,350.00

  @M1
  Scenario: What goes to savings is taken from what is left
    Given a transfer "To Savings" of 500.00 to "Savings" from January 2026
    Then the Statement of January 2026 shows "Expenses" at 1,200.00
    And the Statement of January 2026 shows "To Savings" at 500.00
    And the Statement of January 2026 shows "Leftover" at 1,300.00
    And the Statement of January 2026 shows "From what is left" at 1,800.00

  @M2
  Scenario: Money taken out of an account by hand comes in, and is not income
    Given an investment account "Index fund" holding 0.00
    And "Index fund" gets 10% of the income from January 2026
    When I take 800.00 out of "Savings" in February 2026
    Then the Statement of February 2026 shows "Income" at 3,000.00
    And the Statement of February 2026 shows "From accounts" at 800.00
    And "Savings" ends February 2026 with 4,200.00
    And "Index fund" ends February 2026 with 600.00
    And "Current account" ends February 2026 with 4,800.00
    And net worth changes by 1,800.00 in February 2026

  @M3
  Scenario: What is deducted from an income lowers what it brings home
    Given an expense "Sam – Tax" of 600.00 from January 2026
    And "Sam – Salary" belongs to "Sam"
    And an investment account "Index fund" holding 0.00
    When "Sam – Tax" is deducted from "Sam – Salary"
    And "Index fund" gets 10% of the income from January 2026
    Then the Statement of January 2026 shows "Income" at 3,000.00
    And the Statement of January 2026 shows "Expenses" at 1,800.00
    And "Sam" brings home 2,400.00 in January 2026
    And "Index fund" ends January 2026 with 240.00

  @M4
  Scenario: A row that follows another takes its share of it every month
    Given an expense "Sam – Tax" with no amount yet
    When "Sam – Tax" follows "Sam – Salary" at 25%
    Then "Sam – Tax" is 750.00 in every month from January 2026 to December 2026

  @M4
  Scenario: A row that follows another moves with it
    Given an expense "Sam – Tax" with no amount yet
    And "Sam – Tax" follows "Sam – Salary" at 25%
    When I type 4,000.00 for "Sam – Salary" in June 2026, every month
    Then "Sam – Tax" is 750.00 in May 2026
    And "Sam – Tax" is 1,000.00 in June 2026

  @M5
  Scenario: A category's estimate counts what its rows have not explained yet
    Given an expense category "Home"
    And "Rent" is in the category "Home"
    When the category "Home" is estimated at 1,500.00 from January 2026
    Then the Statement of January 2026 shows "Home" at 1,500.00
    And the Statement of January 2026 shows "Expenses" at 1,500.00
    And "Current account" ends January 2026 with 2,500.00

  @M5
  Scenario: Rows that add up to more than the estimate are the category
    Given an expense category "Home"
    And "Rent" is in the category "Home"
    When the category "Home" is estimated at 1,000.00 from January 2026
    Then the Statement of January 2026 shows "Home" at 1,200.00
    And the Statement of January 2026 shows "Expenses" at 1,200.00

  @M5
  Scenario: A new row in the category takes its amount out of the estimate
    Given an expense category "Home"
    And "Rent" is in the category "Home"
    And the category "Home" is estimated at 1,500.00 from January 2026
    And an expense "Electricity" of 120.00 from February 2026
    When "Electricity" is in the category "Home"
    Then the Statement of February 2026 shows "Home" at 1,500.00
    And the Statement of February 2026 shows "Expenses" at 1,500.00

  @M6
  Scenario: An expense that comes out of savings is spending, and leaves the month's income alone
    Given an expense "Sofa" with no amount yet
    And "Sofa" comes out of "Savings" in every month
    When I type 900.00 for "Sofa" in February 2026, only this month
    Then the Statement of February 2026 shows "Expenses" at 2,100.00
    And the Statement of February 2026 shows "From accounts" at 900.00
    And the Statement of February 2026 shows "Leftover" at 1,800.00
    And "Savings" ends February 2026 with 4,100.00
    And net worth changes by 900.00 in February 2026
    And of that, -2,100.00 is "spending"
