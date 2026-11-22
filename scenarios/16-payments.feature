Feature: Payments by day and method
  When an amount goes out, with what, and paid by whom. A day and a payment method are labels for the Payments page:
  neither moves a figure. Whose money pays for an amount stays "Comes out of", and what is bought on a card stays
  "Paid by card…" on the row (rule C2, scenarios/09-loans-and-cards.feature). Rule W1 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026

  @W1
  Scenario: A day and a method change no figure
    Given a payment method "Standing order"
    When "Rent" is usually paid on day 1 with the method "Standing order"
    Then nothing has changed

  @W1
  Scenario: A day that the month does not have changes no figure either
    When "Rent" is usually paid on day 31
    Then nothing has changed

  @W1 @C2
  Scenario: A method named for a credit card does not put the amount on the card
    Given a credit card "Visa" owing 0.00, whose purchases are expense rows
    And a payment method "Visa card" with the note "Visa"
    And an expense "Groceries" of 400.00 from January 2026
    When "Groceries" is usually paid with the method "Visa card"
    Then nothing has changed
    And "Visa" ends January 2026 with 0.00
    And "Current account" ends January 2026 with 2,400.00

  @W1 @C2
  Scenario: A row that is paid with a card is on the card as a whole, whatever its items are paid with
    Given a credit card "Visa" owing 0.00, whose purchases are expense rows
    And a payment method "PayPal"
    And an expense "Subscriptions" with no amount yet
    And "Subscriptions" is paid with "Visa"
    When I add the item "Films" of 14.00 to "Subscriptions" in January 2026, only this month
    And I add the item "Music" of 11.00 to "Subscriptions" in January 2026, paid with "PayPal"
    Then "Subscriptions" is 25.00 in January 2026
    And "Visa" ends January 2026 with 25.00
    And "Current account" ends January 2026 with 2,800.00

  @W1 @M6
  Scenario: A method whose note names another account leaves where the expense comes out of as it is
    Given another current account "Sam's account" holding 500.00
    And a payment method "Sam's direct debit" with the note "Sam's account"
    And an expense "Insurance" of 90.00 from January 2026
    When "Insurance" is usually paid with the method "Sam's direct debit"
    Then nothing has changed
    And "Sam's account" ends January 2026 with 500.00
    And "Current account" ends January 2026 with 2,710.00

  @W1 @M6
  Scenario: A method leaves an expense that comes out of savings where it is
    Given a savings account "Rainy day" holding 2,000.00
    And a payment method "Direct debit"
    And an expense "Repairs" of 300.00 from January 2026
    And "Repairs" comes out of "Rainy day" in every month
    When "Repairs" is usually paid on day 12 with the method "Direct debit"
    Then nothing has changed
    And "Rainy day" ends January 2026 with 1,700.00

  @W1 @H1
  Scenario: Something that repeats is paid with its own method, and counts as it would without one
    Given a credit card "Visa" owing 0.00, whose purchases are expense rows
    And a payment method "Visa card" with the note "Visa"
    And an expense "Subscriptions" with no amount yet
    And "Subscriptions" gets the item "Films" of 14.00 every month from January 2026, paid with "Visa card"
    Then "Subscriptions" is 14.00 in March 2026
    And "Visa" ends March 2026 with 0.00
    And "Current account" ends March 2026 with 6,358.00
