Feature: Loans and credit cards
  What is owed, and what a payment does. Rules C1 and C2 of docs/calculations.md.

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

  # A credit card is a debt like a loan: what is owed on it comes down with its payment, and what its statement says is
  # typed as a real balance (the owner's decision of 26 November 2026, which reversed finding F5). Nothing is bought
  # "on" a card: an expense is an expense, whatever it is paid with.
  @C1 @C2
  Scenario: A payment brings a card down, and counts as an expense of the month
    Given a credit card "Amex" owing 500.00
    And a payment "Amex – Payment" of 300.00 to "Amex" from January 2026
    Then the Statement of January 2026 shows "Expenses" at 1,500.00
    And "Current account" ends January 2026 with 2,500.00
    And "Amex" ends January 2026 with 200.00

  @C1 @C2 @N2
  Scenario: Paying a card down does not change net worth
    Given a credit card "Amex" owing 5,000.00
    And a payment "Amex – Payment" of 300.00 to "Amex" from January 2026
    Then net worth changes by 1,800.00 in February 2026
    And of that, -1,200.00 is "spending"

  @C1 @C2 @F4
  Scenario: The last payment to a card is what is still owed, and after it the payment counts as nothing
    Given a credit card "Amex" owing 500.00
    And a payment "Amex – Payment" of 300.00 to "Amex" from January 2026
    Then "Amex – Payment" is 300.00 in January 2026
    And "Amex – Payment" is 200.00 in February 2026
    And "Amex – Payment" is 0.00 in March 2026
    And "Amex" ends February 2026 with 0.00
    And "Amex" ends December 2026 with 0.00
    And the Statement of March 2026 shows "Expenses" at 1,200.00

  @C2 @B5
  Scenario: The statement says more is owed on a card than the plan worked out, and the payments count again
    Given a credit card "Amex" owing 500.00
    And a payment "Amex – Payment" of 300.00 to "Amex" from January 2026
    When "Amex" really held 450.00 at the end of March 2026
    Then "Amex" ends February 2026 with 0.00
    And "Amex" ends March 2026 with 450.00
    And "Amex" ends April 2026 with 150.00
    And "Amex" ends May 2026 with 0.00
    And net worth changes by 1,350.00 in March 2026
    And of that, -450.00 is "real balances"

  @C2
  Scenario: What is bought with a card is an expense like any other, and raises nothing that is owed
    Given a credit card "Visa" owing 300.00
    And an expense "Groceries" of 400.00 from January 2026
    Then "Visa" ends January 2026 with 300.00
    And "Current account" ends January 2026 with 2,400.00

  @C2
  Scenario: An expense cannot be put on a card
    Given a credit card "Visa" owing 300.00
    And an expense "Groceries" of 400.00 from January 2026
    When "Groceries" is put on "Visa"
    Then it is refused with 'an expense names no account'

  @C2
  Scenario: A card whose balance is not tracked: its payment is an ordinary expense, and is never cut
    Given a credit card "Visa" that is not tracked
    And a payment "Visa – Payment" of 300.00 to "Visa" from January 2026
    Then "Visa – Payment" is 300.00 in December 2026
    And the Statement of December 2026 shows "Expenses" at 1,500.00

  # A loan and a card are read alike, so one can become the other with everything it has.
  @C1 @C2
  Scenario: A card that becomes a loan changes no figure
    Given a credit card "Amex" owing 500.00
    And a payment "Amex – Payment" of 100.00 to "Amex" from January 2026
    When "Amex" becomes a loan
    Then nothing has changed
    And "Amex" ends March 2026 with 200.00

  @C1 @C2
  Scenario: A loan that becomes a card changes no figure
    Given a loan "Car loan" of 6,000.00, paid off with 250.00 a month from January 2026
    When "Car loan" becomes a credit card
    Then nothing has changed
    And "Car loan" ends March 2026 with 5,250.00

  @C1
  Scenario: A loan cannot become an account that holds money while a row pays it off
    Given a loan "Car loan" of 6,000.00, paid off with 250.00 a month from January 2026
    When "Car loan" becomes a savings account
    Then it is refused with '"Car loan – Payment" pays it off'

  # Cards from before schema 23 had a mode. The app puts them right when it meets them (`planCards`).
  @C2
  Scenario: An older card that recorded only its bill and never owed anything keeps counting the bill
    Given an older credit card "Visa" owing 0.00, of which only the payments were recorded, paid with 120.00 a month from January 2026
    Then "Visa – Payment" is 120.00 in March 2026
    And the Statement of March 2026 shows "Expenses" at 1,320.00

  @C2
  Scenario: An older card that recorded only its payments and owed something is brought down by them
    Given an older credit card "Amex" owing 500.00, of which only the payments were recorded, paid with 100.00 a month from January 2026
    Then "Amex" ends March 2026 with 200.00
    And the Statement of March 2026 shows "Expenses" at 1,300.00

  @C2
  Scenario: An older card whose purchases were expense rows: what was bought comes out of the current account, and the month costs what it did
    Given an older credit card "Visa" owing 0.00, whose purchases were expense rows, paid with 400.00 a month from January 2026
    And an expense "Groceries" of 400.00 from January 2026
    And "Groceries" was bought on "Visa"
    Then "Visa" ends January 2026 with 0.00
    And "Visa – Payment" is 0.00 in January 2026
    And the Statement of January 2026 shows "Expenses" at 1,600.00
    And "Current account" ends January 2026 with 2,400.00
