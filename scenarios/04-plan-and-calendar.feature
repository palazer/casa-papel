Feature: The months of the plan, and the calendar moving on
  How far the plan reaches, and what happens when a new month begins.
  Rules P1 to P4 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026

  @P1
  Scenario: The plan runs to December of this year
    Then the plan runs from January 2026 to December 2026

  @P1
  Scenario Outline: From October on the plan also covers next year
    When the calendar moves on to <today>
    Then the plan runs from January 2026 to <last month>

    Examples:
      | today          | last month    |
      | September 2026 | December 2026 |
      | October 2026   | December 2027 |
      | December 2026  | December 2027 |
      | January 2027   | December 2027 |
      | October 2027   | December 2028 |

  @P2
  Scenario: "Add a year" plans one more year
    When I add a year to the plan
    Then the plan runs from January 2026 to December 2027
    And "Rent" is 1,200.00 in December 2027
    And "Current account" ends December 2027 with 44,200.00

  @P2
  Scenario: Each "Add a year" adds one more
    When I add a year to the plan
    And I add a year to the plan
    Then the plan runs from January 2026 to December 2028

  @P2
  Scenario: "Add a year" from October on adds a year after next year
    Given the calendar moves on to October 2026
    When I add a year to the plan
    Then the plan runs from January 2026 to December 2028

  @P2
  Scenario: An added year stays when the calendar reaches it
    Given I add a year to the plan
    When the calendar moves on to October 2026
    Then the plan runs from January 2026 to December 2027

  @P4
  Scenario: A new month changes nothing in the months before it
    Given a savings account "Savings" holding 5,000.00
    And a transfer "To Savings" of 500.00 to "Savings" from January 2026
    And I type 1,250.00 for "Rent" in March 2026, only this month
    When the calendar moves on to April 2026
    Then nothing has changed

  @P4
  Scenario: A new year of the plan continues every row and every balance
    When the calendar moves on to October 2026
    Then "Rent" is 1,200.00 in every month from January 2027 to December 2027
    And "Current account" starts January 2027 with 22,600.00
    And nothing has changed before January 2027

  @P3
  Scenario: An amount typed in a far month stretches the plan to that year
    Given I add a year to the plan
    And I type 1,400.00 for "Rent" in June 2027, every month
    When the calendar moves on to April 2026
    Then the plan runs from January 2026 to December 2027

  @P3
  Scenario: An exception in the plan's last month does not lengthen the plan
    When I type 1,250.00 for "Rent" in December 2026, only this month
    Then "Rent" is 1,250.00 in December 2026
    And the plan runs from January 2026 to December 2026

  @P3
  Scenario: An item added to the plan's last month only does not lengthen the plan
    When I add the item "Chimney sweep" of 80.00 to "Rent" in December 2026, only this month
    Then "Rent" is 1,280.00 in December 2026
    And the plan runs from January 2026 to December 2026

  # What is left of finding F1: an amount that begins in the plan's last month and is then made that month's alone
  # has to begin in the month after, and that month is in the next year.
  @P3 @A4
  Scenario: An exception in the month an amount began, in the plan's last month, reaches into the next year
    Given I type 1,250.00 for "Rent" in December 2026, every month
    When I type 1,300.00 for "Rent" in December 2026, only this month
    Then "Rent" is 1,300.00 in December 2026
    And "Rent" is 1,250.00 in January 2027
    And the plan runs from January 2026 to December 2027

  @P3
  Scenario: Taking back what lengthened the plan shortens it again
    Given I add a year to the plan
    When I undo
    Then the plan runs from January 2026 to December 2026
