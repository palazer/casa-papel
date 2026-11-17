Feature: Amounts and accounts in another currency
  What a rate does to an amount, to an account and to the months, as far as it holds today and in the currency
  model that is decided. Rules X1 to X13 of docs/calculations.md.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026
    And a current account "Current account" holding 0.00
    And the ECB rate for EUR/USD in January 2026 is 1.1000
    And the ECB rate for EUR/USD in February 2026 is 1.2500
    And the ECB rate for EUR/USD in March 2026 is 1.0000

  @X1
  Scenario: An amount in another currency counts at the rate of its month
    Given an income "Alex – Salary" in USD of 3,300.00 from January 2026
    Then "Alex – Salary" is 3,300.00 in February 2026
    And "Alex – Salary" counts as 3,000.00 in January 2026
    And "Alex – Salary" counts as 2,640.00 in February 2026
    And "Alex – Salary" counts as 3,300.00 in March 2026
    And the Statement of February 2026 shows "Income" at 2,640.00

  @X1
  Scenario: A converted amount is rounded to the cent
    Given an expense "Hosting" in USD of 10.00 from January 2026
    Then "Hosting" counts as 9.09 in January 2026
    And "Hosting" counts as 8.00 in February 2026

  @X3
  Scenario: A month after the last known rate uses the last known rate
    Given an income "Alex – Salary" in USD of 3,300.00 from January 2026
    Then the rate for EUR/USD in April 2026 is 1.0000
    And the rate for EUR/USD in December 2026 is 1.0000
    And "Alex – Salary" counts as 3,300.00 in December 2026

  @X3
  Scenario: A set change per month moves the rates after the last known one
    Given rates after the last known month change by 1% a month
    Then the rate for EUR/USD in March 2026 is 1.0000
    And the rate for EUR/USD in April 2026 is 1.0100
    And the rate for EUR/USD in May 2026 is 1.0201

  @X2
  Scenario: A month without a rate of its own uses the month before it
    Given the ECB rate for EUR/GBP in January 2026 is 0.8000
    And the ECB rate for EUR/GBP in March 2026 is 0.9000
    Then the rate for EUR/GBP in February 2026 is 0.8000

  @X4
  Scenario: A rate I set counts for its month instead of the ECB's
    Given an income "Alex – Salary" in USD of 3,300.00 from January 2026
    When I set my rate for EUR/USD in February 2026 to 1.2000
    Then "Alex – Salary" counts as 2,750.00 in February 2026
    And "Alex – Salary" counts as 3,000.00 in January 2026
    And "Alex – Salary" counts as 3,300.00 in March 2026
    And nothing has changed before February 2026

  @X5
  Scenario: A rate never changes an amount in its own currency
    Given a savings account "Dollar savings" in USD holding 1,000.00
    And an income "Alex – Salary" in USD of 3,300.00 from January 2026
    When I set my rate for EUR/USD in February 2026 to 2.0000
    Then "Alex – Salary" is 3,300.00 in February 2026
    And "Dollar savings" ends February 2026 with 1,000.00
    And "Dollar savings" ends December 2026 with 1,000.00

  @X6
  Scenario: An account in another currency is shown at the rate of each month
    Given a savings account "Dollar savings" in USD holding 1,100.00
    Then "Dollar savings" ends January 2026 with 1,100.00
    And "Dollar savings" is worth 1,000.00 at the end of January 2026
    And "Dollar savings" is worth 880.00 at the end of February 2026
    And "Dollar savings" is worth 1,100.00 at the end of March 2026
    And net worth changes by -120.00 in February 2026
    And of that, -120.00 is "rates"

  @X6
  Scenario: Money moved into an account in another currency arrives at the month's rate
    Given a savings account "Dollar savings" in USD holding 0.00
    And an income "Sam – Salary" of 2,000.00 from January 2026
    And a transfer "To Dollar savings" of 100.00 to "Dollar savings" from January 2026
    Then "Dollar savings" ends January 2026 with 110.00
    And "Dollar savings" ends February 2026 with 235.00
    And "Dollar savings" ends March 2026 with 335.00
    And "Dollar savings" is worth 335.00 at the end of March 2026

  @X1 @A4
  Scenario: An exception in another currency lasts one month, like any other
    Given an expense "Hosting" in USD of 110.00 from January 2026
    When I type 220.00 for "Hosting" in March 2026, only this month
    Then "Hosting" counts as 220.00 in March 2026
    And "Hosting" is 110.00 in April 2026
    And "Hosting" counts as 110.00 in April 2026

  @X6 @B5
  Scenario: A real balance of an account in another currency is typed in that currency
    Given a savings account "Dollar savings" in USD holding 1,100.00
    When "Dollar savings" really held 1,375.00 at the end of February 2026
    Then "Dollar savings" is worth 1,100.00 at the end of February 2026
    And net worth changes by 100.00 in February 2026
    And of that, 220.00 is "real balances"
    And of that, -120.00 is "rates"

  # Decided (D2 in scenarios/FINDINGS.md, rule B9): there will be one main account, in the household's currency, and
  # this will be refused. Until that is built, this is what the app does: the opening amount is converted once, and a
  # later rate does not move it.
  @X6 @parked @D2
  Scenario: A current account in another currency is converted when it opens, and not again
    Given a current account "Dollar account" in USD holding 1,100.00
    Then the current accounts start January 2026 with 1,000.00
    And the current accounts end January 2026 with 1,000.00
    And the current accounts end February 2026 with 1,000.00

  @X7
  Scenario: An amount in a currency without any rate is counted one to one, and the app says so
    Given an expense "Hotel" in CHF of 500.00 from January 2026
    Then "Hotel" is 500.00 in January 2026
    And "Hotel" counts as 500.00 in January 2026
    And the app warns "No CHF→EUR rate"

  @X6
  Scenario: An expense in the account's own currency lowers the account by exactly that amount
    Given a savings account "Dollar savings" in USD holding 1,100.00
    And an expense "Hosting" in USD of 110.00 from January 2026
    When "Hosting" comes out of "Dollar savings" in every month
    Then "Dollar savings" ends January 2026 with 990.00
    And "Dollar savings" ends February 2026 with 880.00
    And "Hosting" counts as 100.00 in January 2026
    And "Hosting" counts as 88.00 in February 2026

  @X8
  Scenario: A changed rate of an earlier month changes that month
    Given an income "Alex – Salary" in USD of 3,300.00 from January 2026
    When I set my rate for EUR/USD in January 2026 to 1.3200
    Then "Alex – Salary" counts as 2,500.00 in January 2026
    And "Current account" ends January 2026 with 2,500.00

  @X4
  Scenario: Removing my rate leaves the month without one of its own
    Given an income "Alex – Salary" in USD of 3,300.00 from January 2026
    And I set my rate for EUR/USD in February 2026 to 1.2000
    When I remove my rate for EUR/USD in February 2026
    Then the rate for EUR/USD in February 2026 is 1.1000
    And "Alex – Salary" counts as 3,000.00 in February 2026

  @X9
  Scenario: Two other currencies are converted through the household's
    Given the ECB rate for EUR/GBP in January 2026 is 0.8000
    Then the rate for GBP/USD in January 2026 is 1.3750
    And the rate for USD/GBP in January 2026 is 0.7273

  # ---------- the currency model that is decided and not built yet (step 4) ----------

  @X10 @planned
  Scenario: A recorded conversion keeps its rate when the month's rate changes
    Given an income "Alex – Salary" with no amount yet
    When I record 3,300.00 USD for "Alex – Salary" in January 2026, converted at 1.1000
    And the ECB rate for EUR/USD in January 2026 is 1.2000
    Then "Alex – Salary" counts as 3,000.00 in January 2026

  @X10 @planned
  Scenario Outline: Any two of the foreign amount, the home amount and the rate give the third
    Given an income "Alex – Salary" with no amount yet
    When I record for "Alex – Salary" in January 2026: <typed>
    Then the conversion of "Alex – Salary" in January 2026 is 3,300.00 USD = 3,000.00 EUR at 1.1000

    Examples:
      | typed                           |
      | 3,300.00 USD at 1.1000          |
      | 3,300.00 USD for 3,000.00 EUR   |
      | 3,000.00 EUR at 1.1000          |

  @X10 @planned
  Scenario: When the foreign amount of a conversion is corrected, its rate stays
    Given an income "Alex – Salary" with no amount yet
    And I record 3,300.00 USD for "Alex – Salary" in January 2026, converted at 1.1000
    When I correct the foreign amount of "Alex – Salary" in January 2026 to 3,520.00
    Then the conversion of "Alex – Salary" in January 2026 is 3,520.00 USD = 3,200.00 EUR at 1.1000

  @X11 @planned
  Scenario: An amount without a recorded conversion uses the official rate of its month
    Given an income "Alex – Salary" in USD of 3,300.00 from January 2026
    And the official rate for EUR/USD on 30 January 2026 is 1.1000
    And the official rate for EUR/USD on 27 February 2026 is 1.2500
    And the official rate for EUR/USD on 13 March 2026 is 1.0000
    Then "Alex – Salary" counts as 3,000.00 in January 2026, at the rate of 30 January 2026
    And "Alex – Salary" counts as 2,640.00 in February 2026, at the rate of 27 February 2026
    And "Alex – Salary" counts as 3,300.00 in March 2026, at the rate of 13 March 2026

  @X12 @planned
  Scenario: The forecast follows the recent trend, and the trend fades out
    Given the EUR/USD rate has risen by 1% a month for the last 12 months, to 1.0000 in March 2026
    Then the forecast rate for EUR/USD in April 2026 is 1.0100
    And the forecast rate for EUR/USD in May 2026 is 1.0181
    And the forecast rate for EUR/USD in June 2026 is 1.0246

  @X12 @planned
  Scenario: A currency can be given its own change per month, or be held where it is
    Given the EUR/USD rate has risen by 1% a month for the last 12 months, to 1.0000 in March 2026
    When I hold the forecast for EUR/USD at the last known rate
    Then the forecast rate for EUR/USD in December 2026 is 1.0000

  @X14 @planned
  Scenario: A virtual account cannot be held in a savings account in another currency
    Given a savings account "Dollar savings" in USD holding 1,100.00
    When a virtual account "Holidays" in "Dollar savings" holding 0.00
    Then it is refused with "Dollar savings"

  @X14 @planned
  Scenario: A virtual account can only move to a savings account in the same currency
    Given a savings account "Savings" holding 5,000.00
    And a savings account "Dollar savings" in USD holding 1,100.00
    And a virtual account "Holidays" in "Savings" holding 600.00
    When I move the virtual account "Holidays" to "Dollar savings"
    Then it is refused with "Dollar savings"

  @X15 @planned
  Scenario: An expense in one currency cannot come out of an account in a third one
    Given the ECB rate for EUR/GBP in January 2026 is 0.8000
    And a savings account "Dollar savings" in USD holding 1,100.00
    And an expense "London hotel" in GBP of 80.00 from January 2026
    When "London hotel" comes out of "Dollar savings" in every month
    Then it is refused with "Dollar savings"

  @X13 @planned
  Scenario: Fifteen currencies are offered
    Then the currencies offered are EUR, USD, GBP, TRY, CAD, AUD, CHF, SEK, NOK, DKK, PLN, CZK, HUF, RON and ISK
