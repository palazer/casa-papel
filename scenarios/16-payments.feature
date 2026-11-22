Feature: Payments by day and method
  When an amount goes out and how. A day moves no figure. A payment method says how an amount leaves and from which
  account; whose money pays for it stays "Comes out of". Rules W1 and W2 of docs/calculations.md; a method that draws
  on a card is rule C2 (scenarios/09-loans-and-cards.feature).

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026

  @W1
  Scenario: A day and a method on the main account change no figure
    Given a payment method "Standing order" that draws on "Current account"
    When "Rent" is usually paid on day 1 with the method "Standing order"
    Then nothing has changed

  @W1
  Scenario: A day that the month does not have changes no figure either
    When "Rent" is usually paid on day 31
    Then nothing has changed

  @W2 @M6
  Scenario: A method that draws on another account of yours: the expense comes out of that account
    Given another current account "Sam's account" holding 500.00
    And a payment method "Sam's direct debit" that draws on "Sam's account"
    And an expense "Insurance" of 90.00 from January 2026
    When "Insurance" is usually paid with the method "Sam's direct debit"
    Then "Sam's account" ends January 2026 with 410.00
    And "Sam's account" ends March 2026 with 230.00
    And "Current account" ends January 2026 with 2,800.00

  @W2 @M6
  Scenario: A method that draws on cash: the expense comes out of the cash
    Given a cash account "Notes" holding 300.00
    And a payment method "Cash" that draws on "Notes"
    And an expense "Market" of 60.00 from January 2026
    When "Market" is usually paid with the method "Cash"
    Then "Notes" ends February 2026 with 180.00
    And "Current account" ends February 2026 with 4,600.00

  @W2
  Scenario: A method that draws on the main account leaves the account an expense comes out of as it is
    Given a savings account "Rainy day" holding 2,000.00
    And a payment method "Direct debit" that draws on "Current account"
    And an expense "Repairs" of 300.00 from January 2026
    And "Repairs" comes out of "Rainy day" in every month
    When "Repairs" is usually paid on day 12 with the method "Direct debit"
    Then nothing has changed
    And "Rainy day" ends January 2026 with 1,700.00
