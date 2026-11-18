Feature: Virtual accounts
  Money set apart inside a savings account. Rules V1 to V4 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And a savings account "Savings" holding 5,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026

  @V1
  Scenario: What is set aside goes into the savings account and into its virtual account
    Given a virtual account "Holidays" in "Savings" holding 600.00, with 100.00 set aside every month from January 2026
    Then the virtual account "Holidays" holds 700.00 at the end of January 2026
    And "Savings" ends January 2026 with 5,100.00
    And "Savings" has 4,400.00 not set aside at the end of January 2026
    And "Current account" ends January 2026 with 2,700.00

  @V1
  Scenario: A virtual account is part of its savings account, and adds nothing to net worth
    When a virtual account "Holidays" in "Savings" holding 600.00
    Then "Savings" ends January 2026 with 5,000.00
    And "Savings" has 4,400.00 not set aside at the end of January 2026
    And net worth is 7,800.00 at the end of January 2026

  @V2
  Scenario: An expense that comes out of a virtual account lowers it and its savings account
    Given a virtual account "Holidays" in "Savings" holding 600.00, with 100.00 set aside every month from January 2026
    And an expense "Trip" with no amount yet
    And "Trip" comes out of "Holidays" in every month
    When I type 500.00 for "Trip" in February 2026, only this month
    Then the virtual account "Holidays" holds 300.00 at the end of February 2026
    And "Savings" ends February 2026 with 4,700.00
    And "Savings" has 4,400.00 not set aside at the end of February 2026
    And the Statement of February 2026 shows "Leftover" at 1,700.00

  # Where the months before a changed source come out of is written into those months. "This and following months"
  # gives them the new amount and leaves the source where it is, so the past of the virtual account does not move.
  @A3 @V2
  Scenario: "This and following months" changes what earlier months cost, not where they come out of
    Given a virtual account "Holidays" in "Savings" holding 2,000.00
    And an expense "Trip" of 100.00 from January 2026
    And "Trip" comes out of "Holidays" in every month
    And "Trip" comes out of the month's income again from May 2026
    When I type 150.00 for "Trip" in March 2026, this and following months
    Then "Trip" is 100.00 in February 2026
    And "Trip" is 150.00 in every month from March 2026 to December 2026
    And the virtual account "Holidays" holds 1,800.00 at the end of February 2026
    And the virtual account "Holidays" holds 1,500.00 at the end of April 2026
    And the virtual account "Holidays" holds 1,500.00 at the end of December 2026

  # Every balance here is right, and the steps pass. What fails is the check "carried": the Statement's line for the
  # virtual account says it changed by -500.00, though it fell from 200.00 to nothing, and "Not set aside" is off by
  # the same 300.00 the other way.
  @V3 @F6
  Scenario: A virtual account that is asked for more than it holds stops at nothing
    Given a virtual account "Holidays" in "Savings" holding 200.00
    And an expense "Trip" with no amount yet
    And "Trip" comes out of "Holidays" in every month
    When I type 500.00 for "Trip" in February 2026, only this month
    Then the virtual account "Holidays" holds 0.00 at the end of February 2026
    And the virtual account "Holidays" is short by 300.00 in February 2026
    And "Savings" ends February 2026 with 4,500.00
    And "Savings" has 4,500.00 not set aside at the end of February 2026

  @V4
  Scenario: A top-up from the savings account moves money inside it
    Given a virtual account "Holidays" in "Savings" holding 200.00
    When I top up "Holidays" with 300.00 from "Savings" in February 2026
    Then the virtual account "Holidays" holds 500.00 at the end of February 2026
    And "Savings" ends February 2026 with 5,000.00
    And "Savings" has 4,500.00 not set aside at the end of February 2026
    And the Statement of February 2026 shows "Leftover" at 1,800.00

  @V4
  Scenario: A top-up from the month's income leaves less
    Given a virtual account "Holidays" in "Savings" holding 200.00
    When I top up "Holidays" with 300.00 from the income of February 2026
    Then the virtual account "Holidays" holds 500.00 at the end of February 2026
    And "Savings" ends February 2026 with 5,300.00
    And the Statement of February 2026 shows "Leftover" at 1,500.00
    And the virtual account "Holidays" holds 500.00 at the end of March 2026

  @V1
  Scenario: A virtual account can take a percentage of the income
    Given a virtual account "Holidays" in "Savings" holding 0.00
    When "Holidays" gets 5% of the income from January 2026
    Then the virtual account "Holidays" holds 150.00 at the end of January 2026
    And the virtual account "Holidays" holds 450.00 at the end of March 2026
    And "Savings" ends March 2026 with 5,450.00
