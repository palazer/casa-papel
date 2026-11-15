Feature: Archiving and restoring
  Something that is archived stops in a month and keeps its past. Rules K1 to K3 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And a savings account "Savings" holding 5,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026

  @K1
  Scenario: An archived row shows nothing from its month on, and keeps the months before
    When I archive the row "Rent" from June 2026
    Then "Rent" is 1,200.00 in May 2026
    And "Rent" is 0.00 in every month from June 2026 to December 2026
    And "Current account" ends June 2026 with 13,000.00
    And nothing has changed before June 2026

  @K1
  Scenario: An archived account is gone from net worth from its month on
    When I archive the account "Savings" from June 2026
    Then "Savings" ends May 2026 with 5,000.00
    And net worth changes by -3,200.00 in June 2026
    And of that, -5,000.00 is "accounts starting or ending"
    And nothing has changed before June 2026

  @K2
  Scenario: A restored row is as it was
    Given I archive the row "Rent" from June 2026
    When I restore the row "Rent"
    Then "Rent" is 1,200.00 in every month from January 2026 to December 2026

  @K2
  Scenario: A restored account that took the rest takes it again
    Given "Savings" takes the rest of the month from January 2026
    And I archive the account "Savings" from June 2026
    When I restore the account "Savings"
    Then "Savings" ends December 2026 with 26,600.00

  @K3 @open @F7
  Scenario: A restored row gets its schedule back
    Given "Rent" is on a schedule of 1,300.00 every month from March 2026
    And I archive the row "Rent" from June 2026
    When I restore the row "Rent"
    Then "Rent" is 1,300.00 in every month from March 2026 to December 2026

  @K3 @open @F7
  Scenario: A restored virtual account is filled again
    Given a virtual account "Holidays" in "Savings" holding 600.00, with 100.00 set aside every month from January 2026
    And I archive the virtual account "Holidays" from March 2026
    When I restore the virtual account "Holidays"
    Then the virtual account "Holidays" holds 900.00 at the end of March 2026

  @K3 @open @F7
  Scenario: A restored account pays again what came out of it
    Given an expense "Storage" of 100.00 from January 2026
    And "Storage" comes out of "Savings" in every month
    And I archive the account "Savings" from June 2026
    When I restore the account "Savings"
    Then "Savings" ends December 2026 with 3,800.00
