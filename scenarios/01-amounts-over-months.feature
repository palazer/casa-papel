Feature: An amount over the months
  What a row shows in a month: the amount typed there, or the amount of the month before.
  Rules A1 to A6 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And an expense "Rent" of 1,200.00 from January 2026

  @A1 @A2
  Scenario: An amount stays until another one is typed
    Then "Rent" is 1,200.00 in every month from January 2026 to December 2026
    And the Statement of June 2026 shows "Expenses" at 1,200.00

  @A2
  Scenario: A row shows nothing before its first amount
    Given an expense "Gym" of 40.00 from April 2026
    Then "Gym" is 0.00 in every month from January 2026 to March 2026
    And "Gym" is 40.00 in every month from April 2026 to December 2026

  @A3
  Scenario: "Every month" changes this month and the months after it
    When I type 1,250.00 for "Rent" in March 2026, every month
    Then "Rent" is 1,200.00 in February 2026
    And "Rent" is 1,250.00 in every month from March 2026 to December 2026
    And nothing has changed before March 2026

  @A4
  Scenario: "Only this month" is an exception of one month
    When I type 1,250.00 for "Rent" in March 2026, only this month
    Then "Rent" is 1,250.00 in March 2026
    And "Rent" is 1,200.00 in every month from April 2026 to December 2026
    And nothing has changed before March 2026

  @A4
  Scenario: Two exceptions in a row each last one month
    When I type 1,250.00 for "Rent" in March 2026, only this month
    And I type 1,300.00 for "Rent" in April 2026, only this month
    Then "Rent" is 1,250.00 in March 2026
    And "Rent" is 1,300.00 in April 2026
    And "Rent" is 1,200.00 in every month from May 2026 to December 2026

  @A4
  Scenario: An exception typed again replaces the first one, and still lasts one month
    When I type 1,250.00 for "Rent" in March 2026, only this month
    And I type 1,260.00 for "Rent" in March 2026, only this month
    Then "Rent" is 1,260.00 in March 2026
    And "Rent" is 1,200.00 in every month from April 2026 to December 2026

  @A4
  Scenario: An exception in a row's first month leaves the months after it empty
    Given an expense "Dentist" with no amount yet
    When I type 180.00 for "Dentist" in March 2026, only this month
    Then "Dentist" is 180.00 in March 2026
    And "Dentist" is 0.00 in every month from April 2026 to December 2026

  @A4
  Scenario: An exception leaves a later amount alone
    Given I type 1,300.00 for "Rent" in July 2026, every month
    When I type 1,250.00 for "Rent" in June 2026, only this month
    Then "Rent" is 1,250.00 in June 2026
    And "Rent" is 1,300.00 in every month from July 2026 to December 2026

  @A3
  Scenario: An amount typed for an earlier month reaches up to the next typed amount
    Given I type 1,300.00 for "Rent" in July 2026, every month
    When I type 1,250.00 for "Rent" in March 2026, every month
    Then "Rent" is 1,250.00 in every month from March 2026 to June 2026
    And "Rent" is 1,300.00 in every month from July 2026 to December 2026

  @A3 @planned
  Scenario: "This and following months" replaces what the following months had
    Given I type 1,300.00 for "Rent" in July 2026, every month
    And I type 1,400.00 for "Rent" in September 2026, only this month
    When I type 1,250.00 for "Rent" in March 2026, this and following months
    Then "Rent" is 1,200.00 in February 2026
    And "Rent" is 1,250.00 in every month from March 2026 to December 2026

  @A3 @planned
  Scenario: "This and following months" is not held back by an earlier exception
    Given I type 1,250.00 for "Rent" in March 2026, only this month
    When I type 1,300.00 for "Rent" in March 2026, this and following months
    Then "Rent" is 1,300.00 in every month from March 2026 to December 2026

  @A3
  Scenario: Zero is an amount: the row stops from that month on
    When I type 0.00 for "Rent" in September 2026, every month
    Then "Rent" is 1,200.00 in August 2026
    And "Rent" is 0.00 in every month from September 2026 to December 2026
    And the Statement of September 2026 shows "Expenses" at 0.00

  @A5
  Scenario: Clearing a month makes it follow the month before again
    Given I type 1,250.00 for "Rent" in March 2026, every month
    When I clear "Rent" in March 2026
    Then "Rent" is 1,200.00 in every month from January 2026 to December 2026

  @A5
  Scenario: Clearing an exception leaves the month after it as it was
    Given I type 1,250.00 for "Rent" in March 2026, only this month
    When I clear "Rent" in March 2026
    Then "Rent" is 1,200.00 in every month from January 2026 to December 2026

  # "Only this month" is kept by writing the old amount into the next month. That month then has an amount of its
  # own that nobody typed, and "Clear" on it lets the exception run on into every later month.
  @A4 @A5 @open @F3
  Scenario: The month after an exception has nothing of its own to clear
    Given I type 1,250.00 for "Rent" in March 2026, only this month
    When I clear "Rent" in April 2026
    Then "Rent" is 1,250.00 in March 2026
    And "Rent" is 1,200.00 in every month from April 2026 to December 2026

  @A6
  Scenario: A month can be a list of items, and shows their sum
    Given an expense "Car" with no amount yet
    When I add the item "Service" of 300.00 to "Car" in March 2026, only this month
    And I add the item "Tyres" of 420.00 to "Car" in March 2026, only this month
    Then "Car" is 720.00 in March 2026
    And "Car" is 0.00 in April 2026

  @A6
  Scenario: An item added to a month that follows the month before keeps that amount
    When I add the item "Extra heating" of 80.00 to "Rent" in March 2026, only this month
    Then "Rent" is 1,280.00 in March 2026
    And "Rent" is 1,200.00 in April 2026

  @A6
  Scenario: A list of items saved for every month hands its sum on as one amount
    When I add the item "Garage" of 100.00 to "Rent" in March 2026, every month
    Then "Rent" is 1,300.00 in every month from March 2026 to December 2026
    And "Rent" is 1,200.00 in February 2026

  @A1
  Scenario: Taking a change back gives the old amounts back
    Given I type 1,250.00 for "Rent" in March 2026, only this month
    When I undo
    Then "Rent" is 1,200.00 in every month from January 2026 to December 2026

  @A1
  Scenario Outline: An amount is kept to the cent
    When I type <amount> for "Rent" in March 2026, every month
    Then "Rent" is <amount> in December 2026
    And the Statement of December 2026 shows "Expenses" at <amount>

    Examples:
      | amount       |
      | 0.01         |
      | 1,234.56     |
      | 999,999.99   |
      | -50.00       |
