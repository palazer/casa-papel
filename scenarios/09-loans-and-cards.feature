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

  @C1 @open @F4
  Scenario: A loan that is paid off owes nothing, and not less than nothing
    Given a loan "Car loan" of 600.00, paid off with 250.00 a month from January 2026
    Then "Car loan" ends February 2026 with 100.00
    And "Car loan" ends March 2026 with 0.00
    And "Car loan" ends December 2026 with 0.00

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
