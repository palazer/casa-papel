Feature: Schedules: amounts that repeat by themselves
  A row on a schedule gets its amount in the months the schedule lands in. Rules H1 to H6 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026
    And an expense "Insurance" with no amount yet

  @H1
  Scenario: A schedule lands in its months, and the months between are empty
    When "Insurance" is on a schedule of 300.00 every 3 months from February 2026
    Then "Insurance" is 0.00 in January 2026
    And "Insurance" is 300.00 in February 2026
    And "Insurance" is 0.00 in March 2026
    And "Insurance" is 300.00 in May 2026
    And "Insurance" is 300.00 in November 2026
    And "Insurance" is 0.00 in December 2026

  @H1
  Scenario: Once a year
    When "Insurance" is on a schedule of 600.00 once a year from April 2026
    Then "Insurance" is 600.00 in April 2026
    And "Insurance" is 0.00 in every month from May 2026 to December 2026

  @H2
  Scenario: A row's first schedule keeps the amounts of the months before it
    When "Rent" is on a schedule of 1,300.00 every month from March 2026
    Then "Rent" is 1,200.00 in every month from January 2026 to February 2026
    And "Rent" is 1,300.00 in every month from March 2026 to December 2026
    And nothing has changed before March 2026

  @H3
  Scenario: A scheduled amount changed for this and the following months
    Given "Rent" is on a schedule of 1,300.00 every month from March 2026
    When I change the item "Rent" of "Rent" to 1,400.00 in June 2026, this and following months
    Then "Rent" is 1,300.00 in every month from March 2026 to May 2026
    And "Rent" is 1,400.00 in every month from June 2026 to December 2026
    And nothing has changed before June 2026

  @H3
  Scenario: A scheduled amount changed for one month
    Given "Rent" is on a schedule of 1,300.00 every month from March 2026
    When I change the item "Rent" of "Rent" to 1,400.00 in June 2026, only this month
    Then "Rent" is 1,400.00 in June 2026
    And "Rent" is 1,300.00 in every month from July 2026 to December 2026

  @H4
  Scenario: A schedule that is stopped lands for the last time in that month
    Given "Rent" is on a schedule of 1,300.00 every month from March 2026
    When I stop the item "Rent" of "Rent" after June 2026
    Then "Rent" is 1,300.00 in June 2026
    And "Rent" is 0.00 in every month from July 2026 to December 2026

  @H5
  Scenario: A new year of the plan gets the schedule's amounts
    Given "Insurance" is on a schedule of 300.00 every 3 months from February 2026
    When the calendar moves on to October 2026
    Then "Insurance" is 300.00 in February 2027
    And "Insurance" is 300.00 in November 2027
    And "Insurance" is 0.00 in December 2027
    And nothing has changed before January 2027

  @H5
  Scenario: An added year gets the schedule's amounts
    Given "Insurance" is on a schedule of 300.00 every 3 months from February 2026
    When I add a year to the plan
    Then "Insurance" is 300.00 in February 2027

  @H6
  Scenario: An item that repeats beside one that does not
    When I add the item "Liability" of 90.00 to "Insurance" in March 2026, repeating once a year
    And I add the item "Late fee" of 15.00 to "Insurance" in March 2026, only this month
    Then "Insurance" is 105.00 in March 2026
    And "Insurance" is 0.00 in April 2026

  @H1
  Scenario: Taking a schedule back restores the row
    Given "Rent" is on a schedule of 1,300.00 every month from March 2026
    When I undo
    Then "Rent" is 1,200.00 in every month from January 2026 to December 2026

  @H2 @open @F8
  Scenario: Taking back a schedule that was added from the list of schedules restores the row
    Given I add the schedule "Rent" of 1,300.00 every month to "Rent" from March 2026
    When I undo
    Then "Rent" is 1,200.00 in every month from January 2026 to December 2026
