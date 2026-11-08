# Casa Papel

Local-first household budgeting. Your money as a month-by-month grid that knows what a household is: who lives in it, what it owns, what recurs, what is saved for, who pays what.

- Runs in your browser. No account needed: your data stays on your device unless you export it. Optional cloud sync keeps an encrypted copy that only your password can open, for the same household on several devices.
- Installable as an app on phone and desktop, works offline.
- Live: https://palazer.github.io/casa-papel/

Try it without touching your own data: https://palazer.github.io/casa-papel/?demo=1 loads a fictional household into a separate sandbox.

## What it does today

- **Grid**: months across, rows down. A cell is a single amount or a list of items; amounts carry forward until you change them, for this month only or from this month on. A row can follow another row (the same amount every month, like a child's long-term savings following the child benefit), and the row menu sets which account a transfer goes into or a payment pays off.
- **Certainty**: every amount is an estimate, certain, or done. It changes how things look, never how they add up: estimates are italic with an amber dashed underline, done amounts get a green dot, and in the current month the dot also shows what is still open (red nothing done yet, amber partly done). Itemized cells can be marked done one item at a time or all at once. Closing a month marks everything done and locks it.
- **Household setup**: adults, children, pets, vehicles, home, company, accounts. Each one suggests the rows it usually needs.
- **Recurring**: rent, salary, insurance, subscriptions, with monthly, quarterly, half-yearly, yearly or custom-month schedules. They land in their due months by themselves. Managed from the grid: change an amount for one month or from now on, skip a month, end the schedule. The full list lives under Household.
- **This month's moves**: the transfers and payments to make this month, as a checklist.
- **Money modes**: pooled income with pocket money per adult, with a per-person view of what each one leaves for the household; or proportional contributions, where shared costs are split by salary share (or all income, or percentages you set), own and paid-for rows go to one person, and Moves shows what each adult sends to which account and keeps.
- **Debts and net worth**: credit cards (purchases on the card or just the payment), loans that come down with their instalments, other assets like a deposit; net worth across all tracked accounts in the grid and in Moves.
- **Pool accounts**: set money aside every month inside a savings account (travel, clothes, gifts) and spend from it without touching the month's leftover. Any spending cell can come out of a pool account or the savings balance, as a single amount or per item; the row menu sets a row's usual source, from this month on or for all months.
- **Balances**: savings and investment accounts get a running balance in the grid. Investments grow at a yearly rate you set, or at the average of the real returns you enter; click any balance to pin what the account really held.
- **Currencies**: rows and accounts can be in another currency. Past month rates come from the European Central Bank (only currency codes and dates leave your device), future months are projected with a drift you control, any month can be overridden by hand.
- **Data**: export and import as a single JSON file; merge from another device; wipe.
- **Cloud sync** (optional, by invitation): sign in with an email and password to keep the household on Supabase and use it on your phone and laptop. Everything is encrypted on the device before it leaves; the server and the person running the project see only ciphertext. Changes merge record by record, newest wins. A recovery code shown once at setup is the way back in if the password is forgotten. Setup for your own project: `docs/sync-setup.md`.
- **Goals**: a balance to reach on an account or pool account, a card or loan to clear, or a net worth target, each with an optional target month. Measured against the plan in the grid, so the bar moves as the plan changes.
- **Colour**: every kind of money has one hue: income, expenses, transfers, balances, pool accounts. Goals are the one thing in gold.
- **Look**: a dark rail on the left (bottom tabs on a phone), a page header per screen, bordered islands instead of cards, Roboto. The design system is written down in `DESIGN.md` and shared with a sibling app.

Status: Wave 1 complete (0, 1a, 1b, 1c, 1d); Wave 2a (colour, goals) and 2b (cloud sync and login) complete; Wave 2c (design system, help, month tracking, categories, delete and archive) in progress. Next: charts, CSV and PDF export, translations.

## Develop

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests (vitest)
npm run build      # production build to dist/
```

## License

MIT
