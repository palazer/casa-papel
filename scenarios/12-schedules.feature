Feature: Schedules: amounts that repeat by themselves
  A row on a schedule gets its amount in the months the schedule lands in. Rules H1 to H7 of docs/calculations.md.

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

  @H3 @A3
  Scenario: A scheduled amount changed for the following months replaces a later one-month amount
    Given "Rent" is on a schedule of 1,300.00 every month from March 2026
    And I change the item "Rent" of "Rent" to 1,500.00 in August 2026, only this month
    When I change the item "Rent" of "Rent" to 1,400.00 in June 2026, this and following months
    Then "Rent" is 1,300.00 in every month from March 2026 to May 2026
    And "Rent" is 1,400.00 in every month from June 2026 to December 2026
    And nothing has changed before June 2026

  @H3 @T3
  Scenario: A scheduled amount that is ticked as done keeps what was paid
    Given "Rent" is on a schedule of 1,300.00 every month from March 2026
    And I change the item "Rent" of "Rent" to 1,500.00 in August 2026, only this month
    And I mark "Rent" as done in August 2026
    When I change the item "Rent" of "Rent" to 1,400.00 in June 2026, this and following months
    Then "Rent" is 1,400.00 in every month from June 2026 to July 2026
    And "Rent" is 1,500.00 in August 2026
    And "Rent" is 1,400.00 in every month from September 2026 to December 2026

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

  @H5
  Scenario: Months that began while the app was not opened get the schedule's amounts
    Given "Insurance" is on a schedule of 300.00 every 3 months from February 2026
    When the calendar moves on to March 2027
    Then "Insurance" is 300.00 in February 2027
    And "Insurance" is 300.00 in May 2027
    And nothing has changed before January 2027

  @H5 @T2
  Scenario: By itself the app fills no month that its schedules had reached before
    Given "Insurance" is on a schedule of 300.00 every 3 months from February 2026
    And the calendar moves on to June 2026
    And a month of "Insurance" that is over has lost its amount without a note: May 2026
    When the calendar moves on to July 2026
    Then "Insurance" is 0.00 in May 2026
    And "Insurance" is 300.00 in August 2026

  # A row that once held a scheduled item is looked at by the app's own pass, which rewrites a typed amount as a
  # list. The mark of an exception has to survive that.
  @A4 @H5
  Scenario: An exception lasts one month on a row that was on a schedule once
    Given "Insurance" is on a schedule of 600.00 once a year from February 2026
    And I mark "Insurance" as done in February 2026
    And I delete the schedule "Insurance" in the list
    And I type 100.00 for "Insurance" in June 2026, every month
    When I type 500.00 for "Insurance" in July 2026, only this month
    Then "Insurance" is 600.00 in February 2026
    And "Insurance" is 100.00 in June 2026
    And "Insurance" is 500.00 in July 2026
    And "Insurance" is 100.00 in every month from August 2026 to December 2026

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

  @H7
  Scenario: A schedule changed in the list of schedules counts from the current month
    Given I add the schedule "Insurance" of 100.00 every month to "Insurance" from January 2026
    When I change the schedule "Insurance" in the list to 120.00
    Then "Insurance" is 100.00 in every month from January 2026 to February 2026
    And "Insurance" is 120.00 in every month from March 2026 to December 2026
    And nothing has changed before March 2026

  @H7
  Scenario: A month that was paid keeps what was paid when the schedule changes
    Given I add the schedule "Insurance" of 100.00 every month to "Insurance" from January 2026
    And I mark "Insurance" as done in May 2026
    When I change the schedule "Insurance" in the list to 120.00
    Then "Insurance" is 100.00 in May 2026
    And "Insurance" is 120.00 in June 2026

  @H7
  Scenario: A first month typed in the list counts as typed
    Given I add the schedule "Insurance" of 100.00 every month to "Insurance" from March 2026
    When I move the start of the schedule "Insurance" in the list to January 2026
    Then "Insurance" is 100.00 in every month from January 2026 to December 2026

  @H7
  Scenario: A schedule that is reactivated runs again from the current month
    Given I add the schedule "Insurance" of 100.00 every month to "Insurance" from January 2026
    And I end the schedule "Insurance" in the list after January 2026
    When I reactivate the schedule "Insurance" in the list
    Then "Insurance" is 100.00 in January 2026
    And "Insurance" is 0.00 in February 2026
    And "Insurance" is 100.00 in every month from March 2026 to December 2026

  @H7
  Scenario: A schedule that ended in a month that is over cannot get a new amount in the list
    Given I add the schedule "Insurance" of 100.00 every month to "Insurance" from January 2026
    And I end the schedule "Insurance" in the list after January 2026
    When I change the schedule "Insurance" in the list to 120.00
    Then it is refused with "Change the amount of a month that is over in that month"

  @H2 @F8
  Scenario: Taking back a schedule that was added from the list of schedules restores the row
    Given I add the schedule "Rent" of 1,300.00 every month to "Rent" from March 2026
    When I undo
    Then "Rent" is 1,200.00 in every month from January 2026 to December 2026
