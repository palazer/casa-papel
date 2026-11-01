# Casa Papel

Local-first household budgeting. Your money as a month-by-month grid that knows what a household is: who lives in it, what it owns, what recurs, what is saved for, who pays what.

- Runs entirely in your browser. No server, no account. Your data never leaves your device unless you export it.
- Installable as an app on phone and desktop, works offline.
- Live: https://palazer.github.io/casa-papel/

Try it without touching your own data: https://palazer.github.io/casa-papel/?demo=1 loads a fictional household into a separate sandbox.

## What it does today

- **Grid**: months across, rows down. A cell is a single amount or a list of items; amounts carry forward until you change them, for this month only or from this month on.
- **Certainty**: every amount is an estimate, certain, or done. It changes how things look, never how they add up. Closing a month marks everything done and locks it.
- **Household setup**: adults, children, pets, vehicles, home, company, accounts. Each one suggests the rows it usually needs.
- **Recurring**: rent, salary, insurance, subscriptions, with monthly, quarterly, half-yearly, yearly or custom-month schedules. They land in their due months by themselves. Managed from the grid: change an amount for one month or from now on, skip a month, end the schedule. The full list lives under Household.
- **This month's moves**: the transfers and payments to make this month, as a checklist.
- **Money modes**: pooled income with pocket money per adult. Income-proportional contributions follow in a later wave.
- **Pools**: set money aside every month inside a savings account (travel, clothes, gifts) and spend from it without touching the month's leftover.
- **Balances**: savings and investment accounts get a running balance in the grid. Investments grow at a yearly rate you set, or at the average of the real returns you enter; click any balance to pin what the account really held.
- **Currencies**: rows and accounts can be in another currency. Past month rates come from the European Central Bank (only currency codes and dates leave your device), future months are projected with a drift you control, any month can be overridden by hand.
- **Data**: export and import as a single JSON file; merge from another device; wipe.

Status: Waves 0, 1a, 1b and 1c are live. Next: Wave 1d, income-proportional contributions, credit cards, loans and net worth.

## Develop

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests (vitest)
npm run build      # production build to dist/
```

## License

MIT
