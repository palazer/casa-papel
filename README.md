# Casa Papel

Local-first household budgeting that knows what a household is: who lives in it, what it owns, what recurs, what is saved for. Each month reads as a statement, money in beside money out; a grid plans the months ahead.

- Runs in your browser. No account needed: your data stays on your device unless you export it. Optional cloud sync keeps an encrypted copy that only your password can open, for the same household on several devices.
- Installable as an app on phone and desktop, works offline.
- Live: https://palazer.github.io/casa-papel/

Try it without touching your own data: https://palazer.github.io/casa-papel/?demo=1 opens a separate sandbox where one click loads a fictional household.

First visit: the welcome screen offers three ways in. Start on this device (everything stays in the browser), Sign in (an existing cloud account), or I have an invite. The demo and a file import are a link away.

## What it does today

- **Statement**: the first screen, on a phone too. One month in accounting form, two halves that always balance: money in beside money out, and under it what you have beside what you owe, with how the month changed each figure. Categories open to their rows, itemized rows to their items. Every line has a tick, and a progress line counts what is done and what is still to pay or to come in. Press a line to overwrite its amount or to say how sure you are. "Balances…" asks what the accounts really held and can count the whole month as done. No month is locked: one that is over says "past" and can still be corrected; a change that reaches into it asks first, naming the months and what changes in them.
- **Grid**: the planning view. Months across from the current one on ("Earlier months" brings back the past), rows down; a month's name opens that month in the Statement. A cell is a single amount or a list of items; amounts carry forward until you change them: for this month only, or for this and the following months, which replaces what later months held (the dialog names those months first, and a month ticked as done keeps its amount). A row can follow another row (the same amount every month, like a child's long-term savings following the child benefit), and the row menu sets which account a transfer goes into or a payment pays off.
- **Certainty**: every amount is an estimate, certain, or done. It changes how things look, never how they add up: estimates sit on a light yellow shade, done amounts get a green dot, and in the current month the dot also shows what is still open (red nothing done yet, amber partly done). Itemized cells can be marked done one item at a time or all at once.
- **Categories**: named groups inside a section (Housing, Living, Transport, Family & pets, Fun, Personal come with a new household). Rows sort by category on the grid, under a small label line, and every other group sits on a faint band in the section's colour. Assign from the row menu or from the Categories card under Household.
- **Household setup**: one screen asks the format, the first month and who and what the household is (adults, children, pets, vehicles, homes, a company). The Statement then opens on the first month with a short checklist and suggests the rows each of them usually needs, where they will appear: type the monthly amount on a suggested line and press Enter, or dismiss it. Accounts, cards and loans are added in the lower half, and one account is given the rest of each month.
- **Archive or delete**: one dialog for rows, accounts, virtual accounts, people & things, schedules, goals and categories. It says what deleting removes and what else changes, and what has to be resolved first. Archiving hides something from a month on, and earlier months stay exactly as they are; archived things wait under Household with a Restore button. Deleting takes it out of every month, and the dialog says which of those months are over. Every removal is one undoable step.
- **Recurring**: rent, salary, insurance, subscriptions, with monthly, quarterly, half-yearly, yearly or custom-month schedules. They land in their due months by themselves. Managed from the grid: change an amount for one month or from now on, skip a month, end the schedule. A posting is ticked on the Statement like any other line. The full list lives under Household.
- **Pocket money and per person**: each adult's income lines are what they put into the household, and each has a pocket money line with an amount or a rule of its own (a fixed amount, a percentage of the household's income, of their own income, or of what is left). With two or more adults, "Per person" under the Statement shows what each brings, spends on themselves, takes as pocket money and leaves for the household.
- **Debts and net worth**: credit cards (purchases on the card or just the payment), loans that come down with their instalments, other assets like a deposit; net worth is one figure on the Statement and in the grid: every tracked account and what stays in the main account, minus cards and loans.
- **Virtual accounts**: set money aside every month inside a savings account (travel, clothes, gifts) and spend from it without touching the month's leftover. Any spending cell can come out of a virtual account or the savings balance, as a single amount or per item; the row menu sets a row's usual source, from this month on or for all months.
- **Balances**: savings and investment accounts get a running balance in the grid. Investments grow at a yearly rate you set, or at the average of the real returns you enter; click any balance to pin what the account really held. A household has one main account, in its own currency: the month's money runs through it, and what stays in it is worked out, with a row and a line of its own; type what the bank says and later months continue from the real number. Any other everyday account (a joint account, a partner's own, one in another currency) is an "Other current account" with a balance of its own: a transfer row moves money into it, and an expense can come out of it.
- **Currencies**: rows and accounts can be in another currency, chosen from a list of fifteen. The app keeps the European Central Bank's rates up to date by itself, once a day (only currency codes and dates leave your device): the latest one for the running month, the last working day's for a month that is over. Months to come follow each currency's recent trend, which fades out (or the last rate is held, or they move by a change you set). Any month can be overridden by hand.
- **Data**: export and import as a single JSON file; merge from another device; wipe. A file picked to bring in first shows what merging it and what replacing everything with it would change.
- **Cloud sync** (optional, by invitation): sign in with an email and password to keep the household on Supabase and use it on your phone and laptop. Everything is encrypted on the device before it leaves; the server and the person running the project see only ciphertext. Changes merge record by record, newest wins. A recovery code shown once at setup is the way back in if the password is forgotten. Setup for your own project: `docs/sync-setup.md`.
- **Goals**: a balance to reach on an account or virtual account, a card or loan to clear, or a net worth target, each with an optional target month. A goal is set on the Statement line it watches, which then carries a small mark and opens to the bar. Measured against the plan in the grid, so the bar moves as the plan changes.
- **Colour**: every kind of money has one hue: income, expenses, transfers, balances, virtual accounts. Goals are the one thing in gold.
- **Look**: a dark rail on the left (bottom tabs on a phone), a page header per screen, bordered islands instead of cards, Roboto. The design system is written down in `DESIGN.md` and shared with a sibling app.
- **Help**: an (i) beside every section title, total, balance, automatic row and setting explains it in a sentence or two, on hover or on tap. "Colours and marks" on the Statement and the Grid is the legend.
- **Guide**: an in-app guide under Settings. What Casa Papel is, then seventeen topics in setup order (starting and the Statement, the grid for planning ahead, people & things, income, spending, schedules, virtual accounts, transfers and the rest of the month, investments, debts and cards, goals, trends, pocket money and per person, currencies, archive or delete, data and privacy, marks and keyboard), each with numbered steps that name the exact controls, the related (i) texts and an "Open <screen>" button. A search field filters the topics as you type over all of it. It reads without a household: https://palazer.github.io/casa-papel/?screen=guide

Status: Wave 1 complete (0, 1a, 1b, 1c, 1d); Wave 2a (colour, goals) and 2b (cloud sync and login) complete; Wave 2c (design system, help, month tracking, categories, delete and archive) complete; Wave 2d (calendar years, currencies, deductions, welcome screen) and 2e (Settings group, the Guide) complete. Next: charts, CSV and PDF export, translations.

## Develop

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests (vitest)
npm run build      # production build to dist/
```

## License

MIT
