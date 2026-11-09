/** The Guide's words (DESIGN.md §2): one module, so a translation can follow later. Topics arrive in `GUIDE`. */

export const REPO_URL = 'https://github.com/palazer/casa-papel'

export const GUIDE_LEAD = {
  title: 'What Casa Papel is',
  paragraphs: [
    'Casa Papel is local-first household budgeting: your household budget as a month-by-month grid that knows what a household is. Who lives in it, what it owns, what recurs, what is saved for, who pays what. It runs in your browser, on your phone as well as your laptop, and works offline.',
    'Money comes in three kinds, each with its own colour: Income, Expenses and Transfers, with Balances beneath them. You type positive numbers and the section says which way the money goes; the "Show expenses as negative red numbers" setting only changes how spending looks, never how it adds up. Nothing hides behind a formula: every total, balance and automatic row has an (i) that says in a sentence how it was worked out.',
    'Your data stays on your device unless you export it; Casa Papel has no server of its own. Optional cloud sync keeps an encrypted copy that only your password can open, for the same household on several devices. Apart from that, only currency codes and dates ever leave the device, when rates are fetched. To try everything without touching your own numbers, the demo sandbox is a separate store with a made-up household: Sam and Alex, their child Robin, Biscuit the dog, The car and The flat.',
  ],
}
