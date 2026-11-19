Feature: One main account
  A household has one main account, in the household's currency: the month's money runs through it. Any other
  everyday account has a balance of its own. Rule B9 of docs/calculations.md, finding D2.

  A household from before the rule had all its current accounts counted together, in any currency. The app puts it
  right when it opens the data: the first current account in the household's currency is the main account, the others
  keep their own balances, and the household is asked once which is the main account.

  Background:
    Given today is 15 March 2026
    And a household in EUR that starts in January 2026

  @B9
  Scenario: A second current account is refused
    Given a current account "Main account" holding 1,000.00
    When a current account "Joint account" holding 400.00
    Then it is refused with "main account"

  @B9
  Scenario: The main account is in the household's currency
    When a current account "Dollar account" in USD holding 1,100.00
    Then it is refused with "currency"

  @B9
  Scenario: Another everyday account has a balance of its own: a transfer row moves money into it
    Given a current account "Main account" holding 1,000.00
    And another current account "Joint account" holding 400.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And a row "To Joint account" that moves 500.00 to "Joint account" from January 2026
    Then "Joint account" ends January 2026 with 900.00
    And "Joint account" ends February 2026 with 1,400.00
    And the main account ends January 2026 with 3,500.00
    And net worth is 4,400.00 at the end of January 2026

  # Before rule B9 both were counted together: 1,400.00, and 1,800.00 a month on it.
  @B9
  Scenario: Two current accounts from before: the first is the main account, the other keeps its own balance, and net worth stays the same
    Given a current account "Main account" holding 1,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026
    When the app opens data from before rule B9 with a current account "Joint account" holding 400.00
    Then "Main account" is the main account
    And "Joint account" is an other current account
    And I am asked which is the main account
    And the main account ends January 2026 with 2,800.00
    And "Joint account" ends March 2026 with 400.00
    And net worth is 3,200.00 at the end of January 2026
    And net worth is 6,800.00 at the end of March 2026

  @B9 @T4
  Scenario: Choosing the other one as the main account
    Given a current account "Main account" holding 1,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    And an expense "Rent" of 1,200.00 from January 2026
    And the app opens data from before rule B9 with a current account "Joint account" holding 400.00
    When I choose "Joint account" as the main account
    Then I am not asked anything
    And I am not asked which is the main account
    And "Joint account" is the main account
    And "Main account" is an other current account
    And the main account ends January 2026 with 2,200.00
    And "Main account" ends March 2026 with 1,000.00
    And net worth is 3,200.00 at the end of January 2026

  # The one case where net worth moves: before rule B9 the dollars were converted once, when the account opened.
  @B9 @X6
  Scenario: One in dollars cannot be the main account: it keeps its balance in dollars
    Given the ECB rate for EUR/USD in January 2026 is 1.1000
    And the ECB rate for EUR/USD in February 2026 is 1.2500
    And a current account "Main account" holding 1,000.00
    When the app opens data from before rule B9 with a current account "Dollar account" in USD holding 1,100.00
    Then "Main account" is the main account
    And "Dollar account" is an other current account
    And "Dollar account" ends February 2026 with 1,100.00
    And "Dollar account" is worth 880.00 at the end of February 2026

  @B9
  Scenario: An archived main account stays in the line, and a new one replaces it
    Given a current account "Old bank" holding 1,000.00
    And an income "Sam – Salary" of 3,000.00 from January 2026
    When I archive the account "Old bank" from February 2026
    And a current account "New bank" holding 0.00, opened in February 2026
    Then "New bank" is the main account
    And the main account ends January 2026 with 4,000.00
    And the main account ends February 2026 with 7,000.00

  @B9
  Scenario: Restoring an old main account while another is open is refused
    Given a current account "Old bank" holding 1,000.00
    And I archive the account "Old bank" from February 2026
    And a current account "New bank" holding 0.00, opened in February 2026
    When I restore the account "Old bank"
    Then it is refused with "second main account"
