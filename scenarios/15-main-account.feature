Feature: One main account
  Decided in November 2026, not built yet: a household has one main account, in the household's currency.
  Rule B9 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026

  @B9 @planned
  Scenario: A second current account is refused
    Given a current account "Main account" holding 1,000.00
    When a current account "Joint account" holding 400.00
    Then it is refused with "main account"

  @B9 @planned
  Scenario: The main account is in the household's currency
    When a current account "Dollar account" in USD holding 1,100.00
    Then it is refused with "currency"
