Feature: People, goals, and the data itself
  Who brings what home, when a goal is reached, and what a file carries. Rules G1, G2 and E1 to E3 of
  docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And a savings account "Savings" holding 5,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026

  @G1
  Scenario: Each adult brings home their own income, less what is deducted from it
    Given an income "Alex – Salary" of 2,000.00 from January 2026
    And an expense "Alex – Tax" of 400.00 from January 2026
    And "Sam – Salary" belongs to "Sam"
    And "Alex – Salary" belongs to "Alex"
    When "Alex – Tax" is deducted from "Alex – Salary"
    Then "Sam" brings home 3,000.00 in January 2026
    And "Alex" brings home 1,600.00 in January 2026
    And the Statement of January 2026 shows "Income" at 5,000.00

  @G2
  Scenario: A goal is reached in the first month the account holds the amount
    Given a transfer "To Savings" of 500.00 to "Savings" from January 2026
    When a goal "Cushion" to have 8,000.00 in "Savings"
    Then the goal "Cushion" is reached in June 2026

  @G2
  Scenario: A goal the plan does not reach says so
    When a goal "Cushion" to have 8,000.00 in "Savings"
    Then the goal "Cushion" is not reached in the plan

  @G2
  Scenario: A goal on net worth
    When a goal "Ten thousand" to reach a net worth of 10,000.00
    Then the goal "Ten thousand" is reached in March 2026

  @E1
  Scenario: A file carries everything: an empty app that imports it shows the same
    Given a virtual account "Holidays" in "Savings" holding 600.00, with 100.00 set aside every month from January 2026
    And an expense "Insurance" with no amount yet
    And "Insurance" is on a schedule of 300.00 every 3 months from February 2026
    And "Savings" really held 5,250.00 at the end of February 2026
    And "Savings" takes the rest of the month from March 2026
    When I export the data and import it into an empty app
    Then nothing has changed
    And "Savings" ends December 2026 with 22,350.00

  @E2
  Scenario: Merging the same file again changes nothing
    Given I export the data to a file
    When I merge that file into the app
    Then nothing has changed

  @E3
  Scenario: Merging an older file does not bring an old amount back
    Given I export the data to a file
    And I type 1,300.00 for "Rent" in March 2026, every month
    When I merge that file into the app
    Then "Rent" is 1,300.00 in March 2026

  # Two devices of one household. The second one has the new amount before the first takes it back, and its copy is
  # the one the first takes in next.
  @E3 @F9
  Scenario: On two devices, an amount that was taken back does not return through the other device
    Given a second device that has synced
    And I type 1,300.00 for "Rent" in March 2026, every month
    And the second device takes in what this one has
    And on the second device, an expense "Gym" of 40.00 from April 2026
    When I undo
    And this device takes in what the second one has
    Then "Rent" is 1,200.00 in March 2026
    And "Gym" is 40.00 in April 2026

  @E3
  Scenario: On two devices, taking an amount back reaches the other device
    Given a second device that has synced
    And I type 1,300.00 for "Rent" in March 2026, every month
    And the second device takes in what this one has
    When I undo
    And the second device takes in what this one has
    Then on the second device, "Rent" is 1,200.00 in March 2026

  @T4 @planned
  Scenario: A file shows what it would change before it is merged
    Given I export the data to a file
    And I type 1,300.00 for "Rent" in March 2026, every month
    When I choose that file to merge
    Then I am shown what it would change here: "Rent" from March 2026, 1,300.00 to 1,200.00
    And nothing has changed

  # The file was made before the change was taken back. Undo removed the amount; the file still holds it, and the
  # merge takes it for something this app has never seen.
  @E3 @F9
  Scenario: Merging an older file does not bring back what was taken back
    Given I type 1,300.00 for "Rent" in March 2026, every month
    And I export the data to a file
    And I undo
    When I merge that file into the app
    Then "Rent" is 1,200.00 in March 2026

  # Taken back and then put back again: the amount is new once more, and newer than its removal, so the other
  # device takes it in although it has seen it removed.
  @E3 @F9
  Scenario: On two devices, an amount that was taken back and put back reaches the other device
    Given a second device that has synced
    And I type 1,300.00 for "Rent" in March 2026, every month
    And the second device takes in what this one has
    And I undo
    And the second device takes in what this one has
    When I redo
    And the second device takes in what this one has
    Then on the second device, "Rent" is 1,300.00 in March 2026
    And "Rent" is 1,300.00 in March 2026
