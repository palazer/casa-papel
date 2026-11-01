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
- **Recurring register**: rent, salary, insurance, subscriptions, with monthly, quarterly, half-yearly, yearly or custom-month schedules. Items are posted into their due months automatically and ticked off as paid.
- **This month's moves**: the transfers and payments to make this month, as a checklist.
- **Money modes**: pooled income with pocket money per adult. Income-proportional contributions follow in a later wave.
- **Data**: export and import as a single JSON file; merge from another device; wipe.

Status: Waves 0, 1a and 1b are live. Next: Wave 1c, pools, investment tracking and currency rates.

## Develop

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests (vitest)
npm run build      # production build to dist/
```

## License

MIT
