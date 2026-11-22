Feature: Loans and credit cards
  What is owed, and what a payment does. Rules C1 to C3 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 1,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026

  @C1
  Scenario: A payment brings a loan down, and counts as an expense of the month
    Given a loan "Car loan" of 6,000.00, paid off with 250.00 a month from January 2026
    Then "Car loan" ends January 2026 with 5,750.00
    And "Car loan" ends December 2026 with 3,000.00
    And the Statement of January 2026 shows "Expenses" at 1,450.00
    And "Current account" ends January 2026 with 2,550.00

  @C1 @N2
  Scenario: Paying a loan down does not change net worth
    Given a loan "Car loan" of 6,000.00, paid off with 250.00 a month from January 2026
    Then net worth is -3,200.00 at the end of January 2026
    And net worth changes by 1,800.00 in February 2026
    And of that, -1,200.00 is "spending"

  @C1 @F4
  Scenario: A loan that is paid off owes nothing, and not less than nothing
    Given a loan "Car loan" of 600.00, paid off with 250.00 a month from January 2026
    Then "Car loan" ends February 2026 with 100.00
    And "Car loan" ends March 2026 with 0.00
    And "Car loan" ends December 2026 with 0.00

  # The payment stops at what is owed: the last one is smaller, and after it nothing counts. The month has that much
  # more left, which is what really happens when a loan is paid off.
  @C1 @F4
  Scenario: The last payment to a loan is what is still owed, and after it the payment counts as nothing
    Given a loan "Car loan" of 600.00, paid off with 250.00 a month from January 2026
    Then "Car loan – Payment" is 250.00 in February 2026
    And "Car loan – Payment" is 100.00 in March 2026
    And "Car loan – Payment" is 0.00 in April 2026
    And the Statement of March 2026 shows "Expenses" at 1,300.00
    And the Statement of April 2026 shows "Expenses" at 1,200.00
    And "Current account" ends March 2026 with 5,800.00
    And "Current account" ends April 2026 with 7,600.00
    And net worth changes by 1,800.00 in March 2026
    And net worth changes by 1,800.00 in April 2026

  # What was planned stays stored. A real balance that says more is owed makes the payments count again.
  @C1 @F4 @B5
  Scenario: A real balance that raises what is owed makes the payments count again
    Given a loan "Car loan" of 600.00, paid off with 250.00 a month from January 2026
    When "Car loan" really held 400.00 at the end of April 2026
    Then "Car loan – Payment" is 0.00 in April 2026
    And "Car loan – Payment" is 250.00 in May 2026
    And "Car loan – Payment" is 150.00 in June 2026
    And "Car loan – Payment" is 0.00 in July 2026
    And "Car loan" ends May 2026 with 150.00
    And "Car loan" ends June 2026 with 0.00

  @C1 @F4
  Scenario: Two payments to one loan take what is owed in their order
    Given a loan "Car loan" of 600.00, paid off with 250.00 a month from January 2026
    And a payment "Car loan – Extra" of 200.00 to "Car loan" from January 2026
    Then "Car loan" ends January 2026 with 150.00
    And "Car loan – Payment" is 150.00 in February 2026
    And "Car loan – Extra" is 0.00 in February 2026
    And "Car loan" ends February 2026 with 0.00
    And the Statement of February 2026 shows "Expenses" at 1,350.00

  @C1 @F4 @A4
  Scenario: Changing a payment that was cut keeps what was planned in the other months
    Given a loan "Car loan" of 600.00, paid off with 250.00 a month from January 2026
    When I type 50.00 for "Car loan – Payment" in March 2026, only this month
    Then "Car loan – Payment" is 50.00 in March 2026
    And "Car loan – Payment" is 50.00 in April 2026
    And "Car loan – Payment" is 0.00 in May 2026
    And "Car loan" ends April 2026 with 0.00

  @C1 @B5
  Scenario: A real balance says what is really owed
    Given a loan "Car loan" of 6,000.00, paid off with 250.00 a month from January 2026
    When "Car loan" really held 5,900.00 at the end of January 2026
    Then "Car loan" ends February 2026 with 5,650.00
    And net worth changes by -3,350.00 in January 2026
    And of that, -150.00 is "real balances"

  @C2
  Scenario: Buying on a card whose purchases are expense rows: the cash stays until the card is paid
    Given a credit card "Visa" owing 0.00, whose purchases are expense rows
    And an expense "Groceries" of 400.00 from January 2026
    And "Groceries" is paid with "Visa"
    Then "Visa" ends January 2026 with 400.00
    And "Current account" ends January 2026 with 2,800.00
    And the Statement of January 2026 shows "Leftover" at 1,400.00
    And net worth changes by 1,400.00 in February 2026

  @C2
  Scenario: Paying that card moves money, and is no expense
    Given a credit card "Visa" owing 0.00, whose purchases are expense rows
    And an expense "Groceries" of 400.00 from January 2026
    And "Groceries" is paid with "Visa"
    And a payment "Visa – Payment" of 400.00 to "Visa" from February 2026
    Then "Visa" ends February 2026 with 400.00
    And "Current account" ends February 2026 with 4,200.00
    And the Statement of February 2026 shows "Expenses" at 1,600.00
    And net worth changes by 1,400.00 in February 2026

  @C2
  Scenario: A row's usual payment method that draws on the card is the same as paying the row with the card
    Given a credit card "Visa" owing 0.00, whose purchases are expense rows
    And a payment method "Visa card" that draws on "Visa"
    And an expense "Groceries" of 400.00 from January 2026
    And "Groceries" is usually paid with the method "Visa card"
    Then "Visa" ends January 2026 with 400.00
    And "Visa" ends March 2026 with 1,200.00
    And "Current account" ends January 2026 with 2,800.00
    And the Statement of January 2026 shows "Leftover" at 1,400.00

  @C2
  Scenario: Two items of one row paid in different ways: only the one paid with the card is owed on it
    Given a credit card "Visa" owing 0.00, whose purchases are expense rows
    And a payment method "Visa card" that draws on "Visa"
    And a payment method "PayPal" that draws on "Current account"
    And an expense "Subscriptions" with no amount yet
    When I add the item "Films" of 14.00 to "Subscriptions" in January 2026, paid with "Visa card"
    And I add the item "Music" of 11.00 to "Subscriptions" in January 2026, paid with "PayPal"
    Then "Subscriptions" is 25.00 in January 2026
    And "Visa" ends January 2026 with 14.00
    And "Current account" ends January 2026 with 2,789.00
    And the Statement of January 2026 shows "Expenses" at 1,225.00

  @C2
  Scenario: On a row that is paid with a card, an item paid another way is not owed on the card
    Given a credit card "Visa" owing 0.00, whose purchases are expense rows
    And a payment method "PayPal" that draws on "Current account"
    And an expense "Subscriptions" with no amount yet
    And "Subscriptions" is paid with "Visa"
    When I add the item "Films" of 14.00 to "Subscriptions" in January 2026, only this month
    And I add the item "Music" of 11.00 to "Subscriptions" in January 2026, paid with "PayPal"
    Then "Visa" ends January 2026 with 14.00
    And "Current account" ends January 2026 with 2,789.00

  @C2 @H1
  Scenario: Something that repeats and is paid with the card is owed on it in every month it lands
    Given a credit card "Visa" owing 0.00, whose purchases are expense rows
    And a payment method "Visa card" that draws on "Visa"
    And an expense "Subscriptions" with no amount yet
    And "Subscriptions" gets the item "Films" of 14.00 every month from January 2026, paid with "Visa card"
    Then "Visa" ends January 2026 with 14.00
    And "Visa" ends March 2026 with 42.00
    And "Current account" ends March 2026 with 6,400.00

  @C3
  Scenario: A payment method that draws on a card that records only its payments moves nothing that is owed
    Given a credit card "Amex" owing 500.00, of which only the payments are recorded
    And a payment method "Amex card" that draws on "Amex"
    And an expense "Groceries" of 400.00 from January 2026
    And "Groceries" is usually paid with the method "Amex card"
    Then "Amex" ends January 2026 with 500.00
    And "Current account" ends January 2026 with 2,400.00

  @C3
  Scenario: A card that records only its payments: the payment is the month's expense
    Given a credit card "Amex" owing 500.00, of which only the payments are recorded
    And a payment "Amex – Payment" of 300.00 to "Amex" from January 2026
    Then the Statement of January 2026 shows "Expenses" at 1,500.00
    And "Current account" ends January 2026 with 2,500.00

  @C3 @F5
  Scenario: What is spent through a card that records only its payments lowers net worth
    Given a credit card "Amex" owing 500.00, of which only the payments are recorded
    And a payment "Amex – Payment" of 300.00 to "Amex" from January 2026
    Then net worth changes by 1,500.00 in February 2026
    And of that, -1,500.00 is "spending"

  @C3 @F5
  Scenario: What is owed on a card that records only its payments stays until a real balance says otherwise
    Given a credit card "Amex" owing 500.00, of which only the payments are recorded
    And a payment "Amex – Payment" of 300.00 to "Amex" from January 2026
    Then "Amex" ends January 2026 with 500.00
    And "Amex" ends December 2026 with 500.00

  @C3 @F5 @B5
  Scenario: A real balance says what is owed on a card that records only its payments
    Given a credit card "Amex" owing 500.00, of which only the payments are recorded
    And a payment "Amex – Payment" of 300.00 to "Amex" from January 2026
    When "Amex" really held 200.00 at the end of March 2026
    Then "Amex" ends February 2026 with 500.00
    And "Amex" ends March 2026 with 200.00
    And "Amex" ends December 2026 with 200.00
    And net worth changes by 1,800.00 in March 2026
    And of that, 300.00 is "real balances"
