# Design system

Casa Papel shares its design system with nfl-fantasy (`/Users/erkinpalaz/Projects/nfl-fantasy/web/DESIGN.md`): the same
stack, tokens, type scale, rail, islands and chips, so the two apps read as siblings. This file is the source of truth
for Casa Papel; when a screen needs something not covered here, extend this file in the same commit. Read it before any
UI work. Reference screens: the Grid (dense, a table that scrolls inside its own box) and Household (a reading page of
air islands).

## 1. Scope and tokens

- Stack: React 19, Vite, Tailwind v4, shadcn `base-rhea` on Base UI primitives (`components.json`: base colour `mist`,
  theme lime, icons lucide), Dexie. Icons: lucide everywhere, the rail included.
- Font: Roboto Variable for everything (`--font-sans`; `--font-heading` is an alias, not a second face).
- Colour tokens live in `src/index.css`. Two layers:
  - **Neutrals** are nfl-fantasy's mist set (background, card, border, muted, ring) with a lime `--primary` that is
    reserved for **the pressed or active control**: `Button variant="default"`, the open screen's rail tile, the
    selected option of a `ViewToggle`. Nothing else is lime.
  - **Kinds of money** (the Casa Papel layer nfl does not have): one hue per kind, `--income` emerald, `--expense` rose,
    `--transfer` sky, `--worth` violet (balances and net worth), `--pool` teal, `--goal` amber (a fill), `--draw` amber-700
    (money taken back out of savings). The values are Tailwind v4 palette steps written out as oklch (700 in light, 400
    in dark), so both apps use the same greens and reds. Each hue has an opaque `*-tint` (9 %) for total rows and a
    fainter `*-band` (5 %) for category groups on the grid. The class strings live in `src/app/hues.ts` (`HUES`,
    `SECTION_HUE`, the `Hue` shape `text / tint / band / fill / bar`). Use the map, never a raw Tailwind colour for money.
  - **State of an amount this month**: `--todo` rose-500 (nothing done), `--partial` amber-500 (partly), `--done`
    emerald-500 (done), drawn only by `DoneDot`. Kept apart from the money hues.
- Radius `--radius: 0.625rem`. Panels `rounded-lg`, inner tables and cards `rounded-md`, chips `rounded`.
- Light mode everywhere except the navigation (rail and bottom tabs), which carries the `dark` class and is the same dark
  on every screen. Dark tokens exist for every light one and are kept in step; there is no theme toggle.

## 2. Shell and page frame

```
App shell        flex min-h-dvh: AppRail (md+) w-[72px] sticky h-dvh dark | main min-w-0 flex-1 p-4 md:p-6 text-sm > mx-auto max-w-[1800px]
                 phones (< 768 px): no rail; BottomTabs fixed at the bottom, dark, main pb-24
Page header      header flex flex-col gap-y-2 > h1 text-2xl font-semibold leading-8 tracking-tight + p text-xs text-muted-foreground
                 toolbar  flex min-h-[28px] flex-wrap items-center gap-x-2.5 gap-y-1 text-xs:
                          Undo Redo (icon-xs ghost) · the screen's controls · the sync cloud at ml-auto
                          a basis-full child (an alert, a notice) wraps onto its own line under the controls
Grid frame       the table in its own scroll box: relative isolate max-h-[calc(100dvh-var(--page-chrome))] overflow-auto rounded-lg border bg-card
Reading page     mx-auto max-w-3xl space-y-4 text-xs of air islands (Household, Data, Guide)
Statement frame  full width, space-y-4: the progress line, then dense islands, one per half and "Per person" last; a
                 half's body is grid grid-cols-1 lg:grid-cols-2 lg:divide-x (max-lg:divide-y): two sides, each a flex
                 column whose total sits at mt-auto, so from 1024 px both totals share a line; below it the sides stack
                 and each keeps its own total. Rows are text-sm and min-h-11 on phones, md:text-xs and md:min-h-7
```

- **Rail** (`src/components/AppRail.tsx`, after FantasyPros' and nfl's): a `<nav aria-label="Screens">`, 72 px, one
  column: the household's monogram (two letters in a 40 px circle with a lime ring; `demo` chip under it in the sandbox;
  its accessible name is always `Casa Papel`, the household's name is only its tooltip, so no screen's name can hide in
  it and `getByRole('link', { name: 'Household' })` stays unambiguous), then one tile per screen: a 40 × 30 `rounded-lg` tile holding a 20 px lucide icon over a `text-[10px] font-semibold`
  label. The open screen's tile is `bg-primary text-primary-foreground` with `aria-current="page"`; the others are
  `text-white/70`, hover `bg-white/10`. Items are real links (`?screen=…`, every other parameter kept, so `?demo=1`
  survives); a plain click opens in place, Cmd-click opens a tab. The rail's order is `RAIL`: Statement, Grid, then
  **Settings**, a group after nfl-fantasy's Research: a `<button aria-expanded aria-controls="rail-settings">` tile with a
  caret in its label, and when unfolded a `role="group"` block on `bg-white/5` holding its pages Household, Data and Guide
  as ordinary links with smaller 32 × 26 tiles. A click on it folded unfolds it and opens the group's page open last
  (`casa.settings.page`, Household at first); a click on it unfolded only folds it (`casa.settings.open`, unfolded until
  someone folds it). Folded while one of its pages is open, the Settings tile wears the lime and `aria-current`.
- **Bottom tabs** (`src/components/BottomTabs.tsx`): the rail's three tiles (Statement, Grid, Settings) as a bar along
  the bottom edge, 56 px tall plus the safe-area inset, `md:hidden`. The Settings tab opens the group's page open last;
  on phones the group's pages switch through `GroupTabs` (`src/components/GroupTabs.tsx`), a `TabBar` named
  `Settings pages` on a hairline right under the page header of Household, Data and Guide, `md:hidden`.
- **Screen state** (`src/app/screens.ts`): `?screen=` wins, then the screen open last (`casa.screen`), then the
  Statement, the first screen on every device (a remembered or bookmarked screen that no longer exists, the Month view
  or Moves, opens it too). The Statement is where a month is read and worked and a household is set up; the Grid is the
  planning view for the months ahead. `rememberScreen` writes both; the address bar follows through
  `history.replaceState`, so Back never walks through screen changes. Data and the Guide are never remembered as the
  screen to land on: they are utilities, so a fresh visit opens the household (or the welcome screen when there is
  none); the Guide also opens without a household.
- **Page header** (`src/components/PageHeader.tsx`): every screen opens with it. The H1 is the screen's name (the rail's
  label); the subline names the frame of reference (`The Demo Household · Sep 2026 – Nov 2027`, `· closed` as a chip).
  The toolbar holds Undo and Redo first, then the controls (`MonthPicker`, Close month, Add <year>), then the
  sync cloud. Errors and warnings are `basis-full` lines: destructive for an action that failed, `text-amber-700` for a
  warning the engine raises.
- **Welcome** (`src/features/home/HomeScreen.tsx`): the one screen without a toolbar (its header carries a `role="status"`
  line for the account dialog's outcome and a `role="alert"` line for an import that failed). One air island "Welcome to
  Casa Papel" lists the ways in as rows: a `sm` button (lime on the recommended path only, `outline` otherwise) and one
  muted sentence each; quiet `xs ghost` links beneath (the demo sandbox, Import a file). Signed out it offers Start on this
  device, Sign in, I have an invite; without sync only the first; in the sandbox it leads with Load the demo household; signed
  in with no household it skips straight to the first setup screen with a "Signed in as …" line and no chooser; a locked or
  undecided cloud copy offers Open Data instead.
- **The first setup screen** (`src/features/setup/SetupStart.tsx`, its checks in `start.ts`): one air island "Set up your
  household", a single screen with no steps. It asks only what the Statement needs before it can open: "Household
  name", "Currency", "Number and date format", "First month" (with the sentence that currency and first month cannot be
  changed afterwards), then "People & things": the adults as name fields (`Adult 1 name`; blank names are skipped, no
  named adult gives "Me") and one line per child, pet, vehicle, home, company or other (a kind select, a name, a bin),
  added with `sm outline` `Add <kind>` buttons, each line with the first sentence of its kind's help. Nothing about
  accounts, rules or how money is shared: those are added where they show. A name used twice is refused in an alert
  under the list, because rows are named after their person or thing. The foot says in one muted sentence what will
  be made ("Makes Sam, Alex, Robin and the usual expense categories. Nothing else yet.") beside the lime "Open the
  Statement"; the title row carries "Back to start" while the chooser exists. The household then opens on the
  Statement, on its first month, with the setup strip (§7).
- **Guide** (`src/features/guide/GuideScreen.tsx`, words in `src/app/guide.ts`, no React there so a translation can
  follow): a reading page that opens without a household. Its header's toolbar holds one control, a `type="search"`
  Input "Search the guide" (`h-7 w-64`, full width under 768 px, Escape clears) and, while searching, a `role="status"`
  line (`4 topics match "virtual"`, `1 topic matches "lisbon"`, `Nothing matches "xyz". Try another word.`). The body is the
  reading frame: the lead island "What Casa Papel is" (three paragraphs, `xs` "Try the demo" hidden in the sandbox,
  ghost "Open on GitHub"), a "Topics" island whose `<nav aria-label="Topics">` is a two-column grid of links to
  `#guide-<key>` (title over summary), then one air island per topic (`id="guide-<key>"`, the title as the heading, the
  summary as the description): one to three paragraphs, an `<ol>` of steps naming the controls in quotes, the model's
  own option texts as a `<dl>` where the topic explains a choice (account types, goal kinds, people & things kinds, the
  four rules, the sharing choices), "Related tips" as a `<dl>` straight from `HELP`, and a footer with
  `Open <screen>` (`xs outline`, `useScreen().go`) and `Topics` (`xs ghost`, `#guide-topics`). A search matches every
  typed word somewhere in those texts, hides the lead and the contents, and wraps the words in `<mark>` on
  `bg-primary/30`. The hits come first as a results list (`<nav aria-label="Results">`, a bordered `divide-y` list of
  links to `#guide-<key>`: the title with the hit count at the right in muted tabular figures, under it one gray line
  around the first hit cut at word boundaries with "…"), best first (a hit in the title, then the most hits, ties in
  guide order), with the matching islands beneath in the same order. `screenHref` keeps the hash, so `#guide-marks` from the legend lands on its topic; leaving the Guide
  drops a `#guide-…` hash. Every `HELP` key is quoted by at least one topic (`tests/app/guide.test.ts`).
- Nothing floats over the content except popovers, menus and dialogs (`z-50`); the rail and tabs are `z-40`.

## 3. Island (the panel)

`src/components/ui/island.tsx`. Every panel is an Island: a bordered card on the card ground, **no shadow and no
coloured bar**. Do not use shadcn `Card` for panels. Two heads:

```
dense    section min-h-0 flex flex-col rounded-lg border bg-card
         h3  px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground   (right slot at ml-auto)
         p   px-2 pt-1 text-[11px] leading-[15px] text-muted-foreground                           (description)
         body min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1
air      h3  flex items-end gap-4 border-b px-4 pt-2 text-sm font-medium leading-5                (a hairline edge to edge)
         p   px-4 pt-3 text-xs text-muted-foreground                                               (description)
         body px-4 pb-4 pt-3
```

- `tone={HUES.x}` colours the title in a kind-of-money hue: Income / Expenses / Transfers lists, Accounts (worth), Virtual
  accounts (pool), Schedules and Transfers to make (transfer), Payments due (expense). Mixed panels stay ink. Goals keep
  an ink title; their gold lives in the bars.
- `description` is the one sentence that explains the panel (Casa Papel explains every option inline). `right` holds a
  count or a small control, `toolbar` a non-scrolling filter row, `tabs` a `TabBar` in place of the title, `onFold` a
  caret that minimizes the island.
- Dense islands for the Statement and small stat panels; air islands for reading pages (Household, Data, the Guide,
  the first setup screen). Titles are sentence case with facts after a middle dot.

## 4. Typography

| Class | Use |
|---|---|
| `text-2xl font-semibold leading-8 tracking-tight` | the page header's H1 only |
| `text-sm font-medium leading-5` | air island titles, the month in the toolbar, one emphasised value |
| `text-sm` | the Statement's rows on a phone (14 px, the one place desktop density does not apply) |
| `text-xs` | body text inside every panel, table and toolbar on desktop; the grid |
| `text-[11px] leading-[15px]` | the muted meta line under a title or row |
| `text-[10px]` | chips, small-caps island titles, the Σ line under a row name, rail labels |

Weights: `font-medium` for names, `font-semibold` for headers and section titles, `font-bold` nowhere. Numbers are
right-aligned and `tabular-nums`; money keeps its cents; missing renders `—` or a muted `·` in an empty grid cell.
Truncation idiom: a `min-w-0` parent, `truncate` on the name, `shrink-0` on siblings.

## 5. Colour semantics

- **Kinds of money** (tokens, §1): section titles and total-row labels in the hue; total rows on their `tint`; spending
  amounts in the expense hue when "show expenses as negative" is on; money taken back out of savings in `--draw`. Numbers
  otherwise stay ink, so the grid never becomes a heat map. A balance below zero (an overdrawn virtual account, savings in the
  red, negative net worth) is in the expense hue whatever the negatives setting: it is a warning, not spending.
- **Certainty**: an estimate sits on a light yellow shade (`--estimate`, yellow-200, `bg-estimate`; `ESTIMATE_SHADE`
  and `statusClass.projected` in `src/app/display.ts`), on every screen: the amount in a rounded pill of the shade,
  upright, in ink. On the Statement a category's subtotal is shaded while a line under it still is. The shade means an
  estimate and nothing else; certain and done are plain, and done has the dot. (Until November 2026 an estimate was
  italic with a dashed underline in the Grid; the Statement's trial settled it.)
- **Done**: one mark only, the `DoneDot` (8 px): a green disc for done in any month; in the current open month also a
  red ring for nothing done and an amber half disc for partly done.
- **Chips** (`src/components/ui/chip.tsx`, `rounded px-1.5 leading-4 text-[10px] font-medium`): zinc a neutral fact or
  idle (`closed`, `automatic`, an account or entity type, `ECB`, `carried`), emerald done or good (`paid`), amber a warning
  or an estimate (`due`, `demo`, `projected`, storage may be evicted), rose missing or late (`missing`), sky information
  or something of yours (`manual` rate, `using +1.50%`), violet a second party. An `outline` variant exists for a
  blocker. Chip copy is lowercase.
- **Lime** (`--primary`): the pressed control only (§1). Never a status.
- **Closed months**: the column's cells on `bg-muted/60`, a lock before the month name, `closed` chip in the sublines.
- **Adjusted balances** (a real balance entered): a dotted underline on the amount. On the Statement the line also
  says how far it is from the plan in muted `text-[11px]` after the name: `entered, +€270.84 against the plan`.
- Never `text-red-600` or `text-green-700`; use the tokens or the chip tones above.

## 6. The grid

`src/features/grid/GridScreen.tsx`. A plain `<table class="border-separate border-spacing-0 text-xs">` in a scroll box of
its own (§2), so its first row (`sticky top-0`) and its label column (`sticky left-0`) stay put while the rest scrolls;
sticky cells paint `bg-card` (or their tint) because they slide over content. The corner cell is `z-30`, the month
headers `z-20`, the label cells `z-10`, and the box is `isolate` so none of them can rise above a dialog or the rail.

- Label column `min-w-[200px]`: the row's name in `text-xs font-medium`, under it the Σ line (`text-[10px]`: the all-time
  total and the share of income), the row menu (`…`) at the right, revealed on hover of the `group` row.
- Month columns `min-w-24`; today's header on `bg-muted` with the month in `font-semibold`; cells `px-1.5 py-0.5` (about
  22 px rows), amounts right-aligned, the done dot in the top-right corner. An empty cell shows a faint `·`.
- The Grid is the planning view, so its columns start at the current month (the plan's first or last month when today
  lies outside the plan). The months before it are one press away: `Earlier months (n)` in the toolbar, an `xs` toggle
  with `aria-pressed` (`outline` at rest, `default`, the lime, while pressed, §1), shown only when there are earlier
  months and kept per device (`grid.earlier`). Hiding columns hides nothing from the sums: the engine counts every
  month, and the Σ line stays the all-time total.
- A month header is a menu button: the month's totals, then `Open in the Statement` (the Statement opens on that month,
  for that visit only: `handMonth` in `src/app/screens.ts`), then `Close month` or `Reopen month`.
- A cell in another currency is two lines: the typed amount over a `text-[10px] leading-3` muted `≈ €3,120` in the household
  currency at that month's rate (the cell button becomes `flex-col items-end`; the certainty styling stays on the amount
  line; the `aria-label` says `, about €3,120`). The label keeps the currency code, a follower's too. A foreign account's
  balance row has a muted `in EUR` sub-row like `Deposited`; the Statement counts the account in the household currency.
- An income cell with deductions shows `net €2,775` as its second line in place of the `≈` line (`aria-label` `, net
  €2,775`). A deduction row's label carries the muted tag `out of <income>` with an (i); a follower that takes a share
  reads `= 25% of <row>`. The cell editor of such an income lists the deductions in a `rounded-md border` block
  (`data-testid="deductions"`, each `−€…`, then a Net line) above the error line.
- "Add row" at a section's foot is inline (`src/features/grid/AddRowInline.tsx`): a name and, when the section has any,
  a category. Under Transfers it also asks what the row does (moves money between your accounts, goes into a savings
  account, deposits into an investment account, fills a virtual account that lost its row, pocket money for an adult, pays
  off a card whose purchases are expense rows), with a second select for the target and one muted sentence under the controls for the chosen kind. A choice without a
  possible target is left out (a second "to savings" under the savings plug, a row that fills a virtual account when each already has one)
  or the sentence says what to add first and Add is disabled. Under Expenses the same select offers "A normal expense" or
  "Pays off a loan or card" with the loans and the cards whose payment is the recorded spending as targets (the
  account's type picks the row kind). A card whose purchases are expense rows gets "Pays off a credit card" under
  Transfers instead, because its payment only moves money (`cardIsItemized` in `src/model/cards.ts` is the one reading
  of that setting for the engine, the split, the store and the grid). The store checks the same rules (`addRowOfKind`,
  `rowTargets`); a choice the lists no longer offer falls back to the first one, and Cancel forgets the choice.
- Section header rows: the chevron and the title in `text-xs font-semibold` in the section's hue; no bar, no fill.
- Categories (`groupRowsByCategory`): inside a section rows sort by category, then by their own order; rows without
  one come last. When the section has categories, each group opens with a label row (`text-[10px] font-semibold
  uppercase tracking-wider text-muted-foreground`, `No category` for the rest) and every other named group sits on the
  section hue's `band` (a 5 % mix, opaque, so sticky label cells can carry it too); the uncategorised group never does.
  The closed-month grey stays a translucent overlay on the cells, so it reads over a band.
- Total rows (`derivedRow` with `band`): the label in the hue on the hue's `tint`, `font-medium`; detail lines under an
  investment account (`Deposited`, `Return`) indented and `text-[11px]` muted.
- Balances open with what stays in the current accounts: one row named like the Statement's line (the one account's
  name, else `Current accounts`), shown once such an account exists or money stays in it, so the rows under Balances
  add up to `Net worth`. It is worked out; a click on a month opens `CurrentBalanceDialog` (§8), and a month whose
  real balances were typed is underlined like the other entered balances.
- Keyboard: arrows move between cells (`data-cell="row,col"`), Enter or Space opens the editor.

## 7. Rows, lists, tables and tiles

- **List rows inside an island**: `divide-y divide-border/60`, `py-1` to `py-1.5`, a chip for the type, the name in
  `font-medium`, muted facts after it, actions as `xs` buttons at `ml-auto`. No outer border around a list that is the
  island's whole body.
- **Tables** (Schedules, Per person, rates): `w-full`, header cells `px-1.5 py-1 font-semibold text-muted-foreground`,
  body cells `px-1.5 py-0.5`, rows separated by `divide-border/60`; a table that is not the island's whole body sits in
  `rounded-md border`. No zebra striping.
- **Stat tiles** (`src/components/ui/stat-tile.tsx`): a small-caps label (in a kind-of-money hue when the number is one)
  over `text-sm font-semibold tabular-nums`, in `rounded-md border` boxes laid out `grid grid-cols-2 gap-2 sm:grid-cols-5`.
  No screen uses them at the moment; like the other unused primitives under `src/components/ui/` the component stays.
- **Progress bars** (goals): `h-2 rounded-full bg-goal-tint` with a `bg-goal` fill, `bg-income` once reached.
- **Statement lines** (`src/features/statement/`, figures from `buildStatement` in `src/engine/statement.ts`): the
  Statement is one month in accounting form, two halves that each balance. "The month": Money in beside Money out,
  closed by the rest (to savings) or the leftover; a month that overruns shows "To cover the month" on the left.
  "At the end of the month": Assets beside Debts and net worth, closed by Free (net worth is one figure in the whole
  app: tracked accounts and what stays in the current accounts, minus debts; `engine.netWorth`), with a muted `change` column before
  the balance on both sides (`+€460.00`, a `·` for none) and the day as the balance column's head. A side opens with
  its name in small caps and closes with its total in `font-semibold` over a hairline. Lines are `min-h-11 text-sm`
  on phones and `md:min-h-7 md:text-xs`, separated by `divide-border/60`, amounts in a fixed right-aligned column:
  a **group** (Income, Taken from accounts, Expenses, Set aside, pay off, Debts, Net worth) is a heading in its hue
  on the hue's `tint` with its lines always under it; a **category**, an account that holds virtual accounts and an itemized row open as an
  accordion (a chevron button with `aria-expanded`, each level 20 px further in, items on `bg-muted/20` with the
  `Repeat` icon when scheduled); a category's amount is the sum of its rows. Tags follow the name and wrap under it
  when there is no room: a zinc chip with the currency code and the original amount in muted `text-[11px]` for a
  line in another currency (the amount column is always the household currency), a rose `no rate` chip, `net €…`
  on an income with deductions, and a zinc chip for what the line is (`automatic`, `calculated`,
  `counted when bought` on a card payment that is shown muted and left out of the sum). Virtual accounts sit by name
  under the savings account that holds them, with `Not set aside` for the rest of it; the right side sums them in
  one `Set aside` line. A line a goal watches carries the goal mark: a 12 px `Target` icon in the goal hue and the
  percentage in muted `text-[11px]`, the income hue once reached, a rose `late` chip when late; opening the line
  shows the goal's name, its bar and the sentence that says how far the plan gets (`goalStatusLine`), with `Edit`
  beside the name; there is no list of all goals. The toolbar holds the `MonthPicker`, `Expand all` / `Collapse all`
  (every category at once; not "Open" and "Close", which would read as the month's), the `Suggestions` toggle, the
  `MarksLegend` and, last, the month's one primary action: `Close month` (`sm`, lime) while it is open, `Reopen month`
  (`sm outline`) once closed; `Close month` is left out while the "Setting up" strip shows. Under the header sits the
  **progress line** (`monthProgress` and `progressText` in `src/features/statement/progress.ts`): a muted `text-xs`
  `role="status"` line with an (i), `7 of 21 done · €… still to pay · €… to come in`, then `All 21 done`, and `Closed ·
  all done` for a closed month; a month with nothing in it shows no line. The month is worked in its upper half: a row and each of its items
  carry the `Tick` before the name (44 px on phones, 24 px with a 12 px dot from 768 px), and the rest of the line is
  a button named `<line>: <amount>` (`, an estimate` when shaded) that opens the cell editor for that row and month.
  An itemized row's chevron is a button of its own, `Items of <row>`. An automatic row has the tick (it marks the
  money as moved) but no button; a closed month has neither. A different amount than planned is typed in the cell
  editor ("Only this month", "Done"); there is no quick sheet for it.
  **Per person** (`src/features/statement/PerPerson.tsx`) closes the page when the household has two or more adults:
  a dense island with an (i), as wide as a half's left side from 1024 px (`lg:w-1/2`, so a label is never a screen
  away from its amounts) and full width below, a column per adult (the names as small-caps column heads in the amount
  column's width)
  and the rows Income, Own spending, Pocket money and, in `font-semibold` over a full hairline, Leaves for the
  household (signed, the expense hue below zero). Rows keep the Statement's heights; more adults than fit scroll
  sideways inside the island.
  **Money in from your own accounts** has two sections that must not be mixed up. `Taken from accounts` is typed:
  rows that move money out of a savings or an investment account into the month, always shown (a faint `·` while
  empty) with `Add row` at its foot offering only those two kinds. `From savings and virtual accounts` is worked out
  from the expenses that come straight out of them: its heading carries the `calculated` chip and an (i), and each
  line names the expenses it paid for in muted `text-[11px]` (`for Weekend trip, Flights`, cut with an ellipsis,
  the full list in the title).
  **A virtual account that is short.** A virtual account never shows less than zero. In a month that takes more out of it
  than it holds, its line in the lower half carries a rose `short €2,730.00` chip and an `xs outline` button `Top
  up…` (named `Top up <virtual account>`), and its line under "From savings and virtual accounts" says `€2,730.00 more
  than it held, taken from <savings account>` in muted `text-[11px]` with the same button. When a virtual account
  becomes short while its month is on screen, the top-up dialog opens by itself; one that was short already only
  shows the chip. The Grid shows the balance at zero in the expense hue with the reason in the
  title. A row whose month is a single labelled item that no schedule posted (a top-up, a one-off purchase)
  shows the label after its name in muted `text-[11px]`.
  **The rule symbol.** A transfer that feeds a savings account, an investment account or a virtual account, and that
  account in the lower half, say how the amount is worked out with one small symbol after the name, never a word
  tag: `ArrowDownToLine` (14 px) for the rest, the percentage in `text-[11px] tabular-nums` for a share of income
  (`10%`), the percentage followed by a 12 px `ArrowDownToLine` for a share of what is left (`20% ↓`), `Equal` for
  a fixed amount, the same sign at half strength for an account no row feeds yet. Muted, 20 px high, 32 px where
  the pointer is a finger; a button named `Rule for <line>: <rule>` (`Set a rule for <account>` when there is none)
  that opens the rule dialog, and the bare symbol with the same name in a closed month. A line a rule works out
  opens the rule dialog when pressed, a fixed one the cell editor; where a line holds both controls, the line's
  button is its name stretched over the line and the symbol sits above it. An account fed by several rows shows no
  symbol of its own. A new transfer to an account opens the rule dialog instead of the cell editor. An adult's
  pocket money line carries the same symbol and opens the same dialog: it takes every rule but the rest, and one
  of its own, a share of that adult's own income, shown as the percentage followed by a 12 px `UserRound`
  (`10% 👤`). A pocket line added without an amount ("Add row", or a suggestion whose amount field was left empty)
  opens the rule dialog straight away. The Grid names
  the same rule after the row's name the way a follower names its row (`= 10% of income`, `= the rest`) and offers
  `Rule…` in the row menu.
  Things are added where they will appear: the foot of Income and Expenses holds the Grid's `AddRowInline` (`Add row`)
  and `AddCategoryInline` (`Add category`, a name and Enter), the foot of Set aside, pay off holds `Add row`, and an
  opened category ends with `Add row to <category>` with that category already chosen. A category is a line from
  the moment it exists, its amount a faint `·` until it has a row, so its first row is added inside it. A new row
  opens its category and, in an open month, the cell editor for its first amount. In the lower half a line that can
  have a goal (an account, a virtual account, a debt, Net worth) shows a 20 px ghost `Target` button after its name on
  hover or focus, always where the pointer is a finger, named `Set a goal for <line>`; it opens the goal dialog with
  what the goal watches settled, so the dialog asks for the amount only. A goal's detail carries an `xs ghost` `Edit`. An account's balance
  is a button named `<account> balance: <amount>` (`, entered` once it is) that opens the Grid's `BalanceDialog`.
  The line for what stays in the current accounts (the one account's name, else `Current accounts`) is worked out
  and says so with the `calculated` chip; its amount is the same kind of button and opens `CurrentBalanceDialog` (§8).
  Once the real balances are typed for a month the chip goes, the amount is underlined like any entered balance, the
  line says `entered, -€120.00 against the plan`, and its parts (At the start of the month, Kept this month, the card
  lines) gain `Not in the plan`, so they still add up. The month after is `calculated` again, from the real number.
  **Accounts are added in the lower half too**, in the same ghost `+` buttons as rows: the foot of the Assets side
  holds `Add account` (current, joint, savings, investments, other asset, cash) and, once a savings account exists,
  `Add virtual account`; `Add a card or loan` sits at the foot of the Debts group, and at the foot of that side while
  nothing is owed. A new savings or investment account opens the rule dialog as soon as it is saved, on `The rest`
  for a savings account while nothing takes the rest yet; a new virtual account asks for its monthly amount in its own
  dialog, counting from the month on screen.
  **Changing and removing.** What is added on the Statement is changed and removed there too. In an open month a
  row, a category, an account and a virtual account carry a `…` after their name and tags: a 20 px ghost icon button
  (`LINE_MENU`: shown while the line is hovered or the control has the focus, always and finger-sized where the
  pointer is a finger), 20 px so the line keeps its height. On a row it is the Grid's own `RowMenu` (`Row menu for
  <row>`), unchanged. On a category it is `CategoryMenu` (`Category menu for <category>`): `Rename…` (a small dialog
  whose error stays beside the field), `Move up`, `Move down`, and removing; its rows are kept. On an account or a
  virtual account it is named `Edit <name>` and opens the account or virtual account dialog, which removes at its foot
  (how removing behaves, and when it is one click, is in §8);
  the calculated line for the current accounts opens the one account behind it, or lists them (`Edit a current
  account`) when there are several. So that a line can hold these beside its own action, every row line that opens
  something is built the way a line with a rule symbol is: its button is its name, stretched over the whole line,
  and the symbol and the menu sit above it. A menu behind an icon is as wide as its longest entry (`w-max`), never
  as narrow as the icon. A closed month shows none of this.
  **Suggestions.** `Suggestions` in the toolbar (a pressed button with an (i); on while a household is being set up,
  off otherwise, disabled in a closed month) shows the rows a household like this one usually has, where they will
  appear: above the add controls of Income, Expenses and Set aside, pay off, and inside the category a row belongs
  to. A category with a usual suggestion opens by itself. A suggestion is not a row, so it is drawn as an add
  control, not as a line: a muted `+`, the row's name in muted medium weight, its one-sentence description in muted
  `text-[11px]`, then a 28 px amount field (`per month`, named `Amount per month for <row>`), an `xs outline` `Add`
  and a ghost `×` named `Dismiss <row>`. Enter in the field adds the row with that amount from the month on screen
  on; `Add` with the field empty adds it without one; no dialog opens. An amount that cannot be read shows its error
  under the line and disables `Add`. A suggestion that needs an account the household does not have shows a zinc
  chip (`needs a loan account`) in place of the field and the button. Under the usual ones a dotted-underlined link
  `More suggestions (n)` opens the rarer and the dismissed ones, which have no `×`. Each block is a group named
  `Suggestions for <part>`. Under Assets the same line offers an account most households have (`Main account`,
  `Savings`); its `Add` opens the account dialog with the name and type filled in.
  **The setup strip.** While a household is new (`Household.setupOpen`), a dense island "Setting up" with an (i)
  sits between the toolbar and the month. It holds the parts of the page as pills in the order a household is
  filled: `Income`, `Accounts`, `Expenses`, `Where the rest goes`, `Goals (optional)`. A pill is a rounded-full
  outline button with a 14 px mark: an empty circle while its part is empty (the label in medium weight), a check in
  the income hue once it has something in it (the label muted). Pressing one goes to its part with the cursor in the
  first field; `Where the rest goes` opens the rule dialog on the savings account, or the account dialog for one
  while there is none. Two muted sentences follow: what to do next (the first open step), and which month is being
  filled. `Done` (`xs outline`, at the end of the title row) hides the strip for good and turns the suggestions
  off; the page works the same without it. The Statement opens on the household's first month while the strip shows.
  **Category estimates.** An expense category can carry an estimate: what it should come to in a month, typed before
  its rows are known. The category line then reads `estimate €1,450.00` in muted `text-[11px]` after its name, and
  its last line is `Not broken down yet` with the `automatic` chip, the estimate minus the category's rows, on the
  estimate shade until it is ticked or the month closes. It shrinks as rows are added and is gone at zero; once the
  rows add up to more, the category shows their sum and still names its estimate, with no mark for being over. The
  line is a button that opens the estimate it comes from, and the opened category's foot holds `Set estimate` /
  `Change estimate` beside `Add row to <category>`. `Add category` under Expenses takes an optional estimate
  (`Estimate`, `EUR per month, optional`), so a category can be a name and a number and count at once. The engine
  keeps the estimate on a row of kind `category-estimate` in that category, so every screen counts the same rest:
  the Grid shows it as an automatic row named `<category> – Not broken down yet`. "No category"
  and income categories have none.

## 8. Controls

- Buttons: `size="sm"` (28 px) for a toolbar's one primary action (`Close month`, `Export now`), `size="xs"` (24 px) for
  everything else in toolbars, lists and islands, `icon-xs` for icon buttons in toolbars. Dialog footers keep the default
  size. Variants: `default` (lime) for the primary action or the active toggle, `outline` for the rest and inactive
  toggles, `ghost` for quiet actions (Edit, Cancel), `destructive` for the irreversible. Toggle idiom:
  `variant={active ? 'default' : 'outline'}` (the entity-kind picker under People & things).
- `MonthPicker`: two `icon-xs outline` buttons around the month as an `h2 text-sm font-medium`; lives in the page
  header's toolbar (the Statement) or an island's first line (Schedules). At the last planned month the Next button gives
  way to an `xs outline` `Add <year>`, the Grid toolbar's action: the plan always ends in a December and grows a calendar
  year at a time (`planEnd` in `src/store/months.ts`; this year's December, next year's from October on).
- One name per idea, the same in every control: a repeating amount is a **schedule** (dialog "New schedule" / "Edit
  schedule", button "Add schedule", never "recurring item"); how a transfer into an account, or an adult's pocket money, is worked out is its **rule** ("A fixed amount", "A
  percentage of income", "A percentage of what is left", "The rest"; for pocket money "A percentage of <Adult>'s
  income" in place of the rest), set in the rule dialog and nowhere else. There is no household-wide pocket money
  total: each adult's line has its own amount or rule; money
  set aside is a **virtual account**, never an envelope.
- Rates are always spelled with both codes in the orientation whose number is ≥ 1 (`1 EUR = 1.08 USD`, `1 USD = 48.58 TRY`;
  `readableRate` in `src/features/household/fxDisplay.ts`); the rates table's columns read `1 EUR in USD` and store
  `base/foreign`. The cell editor's rate line (`src/features/grid/RateLine.tsx`) sits under an amount in another currency:
  `≈ €3,120.00 · 1 EUR = 1.084 USD · [ECB] 2 Nov 2026` with the table's chip tones, a ghost `xs` "Change this month's
  rate…" that reveals an inline input (one rate per currency per month), and "Use the ECB rate again" while the rate is
  manual. The ECB day is the Month rate setting's, the first business day by default.
- A currency is always chosen from a list, never typed: `currencyChoices` in `src/app/currencies.ts` (the household's
  own first, labelled `EUR (household currency)`, then the currencies the ECB publishes; a code in use that is not on
  the list stays selectable). A currency that comes into use and has no rate at all yet gets the ECB's by itself
  (`useAutoRates` in the app shell, once per session per currency; only currency codes and dates are sent). The field
  that brings it in says so in its inline text. Offline, or for a currency the ECB does not publish, the amounts stay
  unconverted and the rates card under Household is where a rate is typed or fetched again.
- A row's menu (`src/features/grid/RowMenu.tsx`) runs Rename…, Move up, Move down, Category…, Belongs to…, Currency…,
  then Treat new values as…, Comes out of…, Deducted from an income… (spending rows, followers included; it names the
  income once set), the account verb, Follow another row…, then Archive or delete… or Restore. Belongs to offers the
  household, an Adults group and an Other people & things group (`name · kind`), and nothing else: who a row is for
  is what "Per person" under the Statement counts and what a pocket money rule's "percentage of <Adult>'s income" is taken of.
  There is one way of sharing money (each adult's income lines are what they put in), so no screen asks for a mode,
  a split or who pays for a child, pet or thing; Deducted from lists the live income rows after "Nothing: a normal expense" (an archived income the row still points at stays listed as "<name> (archived)");
  Follow another row shows "Share (%)" once a row is chosen (100 mirrors it). Each dialog's help sentence is the
  `HELP` text of its field, so the (i) and the explanation never drift apart.
- `TabBar` switches an island's view (`src/components/ui/tab-bar.tsx`); `ViewToggle` filters a list
  (`src/components/ui/view-toggle.tsx`); `Segmented` stays for a form field with a few options (certainty, applies to).
- Native `<select>` through `NativeSelect` for form fields; `MonthField` for months (Safari has no month input).
- Checkboxes are the native `Check` (16 px) in forms and in lists that tick things off (a schedule's months). The
  Statement's `Tick` (`src/components/Tick.tsx`) is a `role="checkbox"` button of 44 × 44 px whose face is the `DoneDot`
  at 20 px (`aria-checked` true, `mixed` or false), named `<line> done`; one tap marks done, a second tap goes back to
  the row's default. From 768 px it is smaller through `className` and `dotClassName`. Automatic rows (the rest, a row
  a rule works out, followers) tick through `Cell.markedDone`.
- The balance dialog (`src/features/grid/BalanceDialog.tsx`) of a card whose purchases are expense rows offers, when the
  typed balance is above the expected one, a `rounded-md border` block (`data-testid="book-difference"`) with a
  `Check` "Count the €400.00 difference as spending this month" and one muted sentence saying where it goes (a done
  item "Not recorded" on the row `<card> – Not recorded`, paid from the card) or, unticked, that the debt rises
  with no line to explain it. Ticked for a balance typed now, unticked when the dialog opens on an older difference.
  Other accounts never see it: for a card that records only its payments it would count the money twice
  (`setCardBalanceBooked` in `src/store/actions.ts`).
- The current accounts' balance dialog (`src/features/grid/CurrentBalanceDialog.tsx`, the same frame as the balance
  dialog) asks for what every current account held at the end of the month: `Worked out, together` as a muted line,
  then one field per account that exists in that month, labelled `<account> (<CCY>)` (one account alone: the dialog
  carries its name and the field reads `Real balance in <CCY>`), then `Together` and `Difference` as soon as every
  field holds a number (household currency only; another currency is converted on saving and the dialog says so).
  All or none: a half-filled dialog says "Fill in every account, or leave them all empty to use the calculated
  amount." in place and saves nothing, because the plan only knows what the accounts hold together. `Use the
  calculated amount` (ghost, left) clears them; a closed month disables the fields and says why. The difference is
  shown, never booked as spending: where an account takes the rest, extra spending would lower that transfer in the
  plan, not the current accounts (`setCurrentBalances` in `src/store/householdActions.ts`).
- The estimate dialog (`src/features/statement/EstimateDialog.tsx`), titled `Estimate for <category> · <month>`: one
  amount in the household currency with an (i) (`row.categoryEstimate`), then two read-only lines that follow what
  is typed (`Rows this month`, `Not broken down yet`; a muted sentence when the rows already add up to more), then
  "Applies to" as the cell editor's `Segmented` (`This month and onwards` / `Only this month`). Footer: a ghost
  `Remove estimate` when there is one, Cancel, Save. A closed month disables it.
- The rule dialog (`src/features/rules/RuleDialog.tsx`), titled `How much goes to <account>?`: "Rule" as a
  `Segmented` (`A fixed amount`, `A percentage of income`, `A percentage of what is left`, `The rest`) with the
  chosen option's sentence under it (for the rest, also what a month that overruns does to that account), then that option's one field (`Amount per month in
  <CCY>` or the percentage), then "Counts from" as a `MonthField` with an (i) and the sentence that earlier months
  keep their amounts. It opens on the month it was called from, or on the first month after the last closed one.
  Two read-only lines follow what is typed: what the account gets in that month, with the sum the percentage is
  taken of, and what is then left for the rest (or as leftover). A muted sentence says so when the rest would
  move from another account or stop being taken. The figures and every refusal come from running the save on a
  copy, so the dialog never shows a number or allows a Save the store would not. Footer: Cancel, Save.
  For an adult's pocket money the same dialog is titled `How much pocket money does <Adult> get?` and offers `A
  fixed amount`, `A percentage of income`, `A percentage of <Adult>'s income` and `A percentage of what is left`,
  never `The rest`; the first read-only line then names whose income (`10% of €4,200.00, Sam's take-home income`).
  A pocket line that still is a share of the pocket money total from before says so in the description; saving
  gives it its own rule from the chosen month on.
- The top-up dialog (`src/features/statement/TopUpDialog.tsx`), titled `<virtual account> is short in <month>`: one
  sentence with what comes out, what it holds and what is missing; "Top it up from" as a `Segmented` (the virtual
  account's own savings account first, as `<account>, not set aside · <free amount>`, then the other savings and
  investment accounts with their balance, then `This month's income`) with a sentence for the chosen source; the
  amount, pre-filled with what is missing; and under `<month> will then show` the lines the save will leave (`Money
  in · From <account>`, `Money out · To <virtual account>, this month`, the virtual account's balance), worked out on a
  copy. Footer: a ghost `Not now` on the left, `Top up` on the right. `Not now` changes nothing.
- The account dialog (`src/features/household/HouseholdAccountDialog.tsx`), one for the Household screen and the
  Statement. The short form asks what every account needs: `Name`, `Type` with the type's sentence under it, and
  one amount whose label says what it is and when: `Holds at the start of <Month> (<CCY>)`, `Owed at the start of
  …` for a card or loan, `Worth at the start of …` for another asset. A card adds "What do you record for this
  card?" as a `Segmented` (`Everything I buy with it` / `Only what I pay to it`) with the chosen answer's sentence.
  Everything that has a usual default sits behind a `More options` disclosure (a chevron button that names what it
  holds while closed): currency (a `NativeSelect`), opening month, owner, tracking, and for investments growth, projection and when
  deposits count. It is closed for a new account and open when editing. Opened from a place that says what the
  account is (Assets, Debts, a suggestion), the type list holds only the types that belong there. Errors show in the
  dialog. Footer: a ghost `Archive or delete…` on the left when editing, Cancel, Save.
- The goal dialog (`src/features/goals/GoalDialog.tsx`). A goal has two kinds: `Fill an account` (an account or a
  virtual account reaches an amount) and `Pay down a debt` (a card or loan comes down to an amount, zero unless another
  is typed); net worth is a third, set only from its own line. Opened from a line of the Statement it is titled
  `Goal for <line>`, says in one sentence what it does (`Fills Travel to an amount.`) and asks only for the name
  (pre-filled with the line's name), the amount, the target month and notes. Editing (`Edit goal`) asks the same:
  what a goal watches does not change, a different thing is a new goal. Every goal starts on a line today; opened
  without one (`New goal`, no screen does) the dialog asks first for "Kind" as a `Segmented` of the two, with the chosen kind's sentence under it, and "Tracks" as one select
  (accounts and virtual accounts in two option groups for filling, cards and loans for paying down). The amount is
  labelled `Target (<CCY>)`, and `Bring it down to (<CCY>)` for a debt, with the sentence that zero means nothing
  is owed. Footer: a ghost `Delete…` on the left when editing, Cancel, Save.
- Dialogs are shadcn `Dialog`; the confirm step lives inside the dialog, never behind it. Errors appear beside the field
  that caused them, `role="alert"`.
- Removing anything goes through one `RemoveDialog` (`src/features/remove/RemoveDialog.tsx`), reached from a row's
  menu ("Archive or delete…"), the People & things list, the account, virtual account and goal dialogs' footers
  ("Archive or delete…", "Delete…"), the schedules list, the cell editor's "All occurrences" and the Categories card.
  Title `<Kind> "<name>"`, then an Archive section (a `MonthField` "Archive from" with an (i), what changes from that
  month, "Earlier months stay exactly as they are") and a Delete section ("Deleting removes", "Also changes", a note,
  and blockers in a destructive `Alert` "Resolve these first" that says where to fix each). When the thing has amounts
  in a closed month the Delete section is one sentence saying so, and only Archive remains; an archive month inside
  that history is refused beside the field. Footer: Cancel, `Archive from <month>` (`outline`, `default` when it is
  the only choice), `Delete` (`destructive`, disabled with blockers). The words and the write come from the same scan
  (`describeRemoval` and `planRemoval`/`planArchive` in `src/store/impact.ts`), so they cannot disagree, and every
  removal is one undoable commit ("You can undo this right after"). Archived things are listed with Restore under
  Household: Archived rows, and an Archived line in Accounts, Virtual accounts and People & things.
- **Cheap while setting up.** While a household is being set up (`Household.setupOpen`, the strip of §7), removing
  is one click: the entry in the row menu, the category menu and the account and virtual account dialogs opened from
  the Statement reads `Delete` instead of `Archive or delete…` / `Remove…` and deletes at once, with no dialog
  (`removeIfFree` in `src/store/remove.ts`). It does so only when nothing but the thing itself goes: when rows would
  change, something stands in the way, a goal watches it, or a closed month holds its amounts, the remove dialog
  opens as always and says what. After `Done`, and for every household set up before, removing is the dialog again.
  A one-click delete is answered by the one floating message the app has: a small bordered card (`bg-card`,
  `shadow-md`, `role="status"`) fixed at the foot of the window, above the bottom tabs on a phone, reading `Deleted
  "<name>".` with an `xs outline` `Undo` and a ghost `×`. It floats because what was deleted can be anywhere on a
  long page, and it goes away with the next change, so its `Undo` always takes back that delete.
- Help is one mechanism: `InfoTip` (`src/components/InfoTip.tsx`), a 16 px (i) in `text-muted-foreground/70` (24 px
  where the pointer is a finger) that opens a `w-64 text-xs` popover on hover after 150 ms and on tap, and closes when
  the mouse leaves, on Escape or on a click outside. Its accessible name is `About <title>`. It is a sibling of the thing
  it explains, never inside a `<label>`, `<button>`, `<legend>` text or menu item (in Playwright, a field with a tip is
  found with `getByLabel(name, { exact: true })`, since the (i)'s name contains the field's): `TipLabel` pairs a form label with one,
  `Island`, `StatTile` and the grid's `derivedRow` take a `help` key, the grid's row label puts
  it between the name and the row menu. Where it goes: section titles, every total and balance the app works out,
  automatic and following rows, stat labels, the cell editor's "Applies to", "How sure", "Comes out of", its rate line and its deductions block, a row's currency, who a row belongs to, what it is deducted from and its share of a followed row, the `in EUR` balance line, the Statement's progress line, its two halves, its Set aside group, its main account line, Net worth, Free and "Per person", the
  household settings, "Track the balance", the Archived list, Goals and the schedules' status column.
- Every text lives in `src/app/help.ts`: `HELP[key] = { title, text }`, keys `area.name`, titles up to 40 characters,
  texts two or three plain sentences up to 360 characters in the app's own words (virtual accounts, people & things,
  schedules, automatic). `balanceHelp(type)` picks the balance text for an account. Texts that belong to a model enum
  (section blurbs, account types, entity kinds, goal kinds, the rules) stay in `src/model/templates.ts`.
- `MarksLegend` ("What the colours and marks mean", an `xs outline` button in the Statement and Grid toolbars) is the legend:
  the six hue dots with their kinds of money, then the marks with a sample each: estimate, certain, done, this month's
  red and amber dots, the negative spending number when that setting is on, the amber draw, the dotted entered balance,
  the locked closed month, the category band. It ends with a ghost `xs` "More in the Guide" that opens the Guide's
  Marks & keyboard topic (`#guide-marks`). The welcome screen's quiet links carry "How it works" for the same page.

## 9. Loading, errors, empty

- Loading is nothing (the store is local; `useLiveQuery` resolves within a frame), never a spinner.
- An action that failed shows a `role="alert"` line in `text-destructive` in the page header's toolbar or beside the
  control; an engine warning is `text-amber-700`. Data-screen outcomes use the `Alert` block. Nothing floats, with
  one exception: the Statement's `Deleted "<name>". Undo` after a one-click delete (§8).
- Empty states are one muted sentence that says what to do (`Nothing to transfer.`, `Add a savings account first; virtual
  accounts live inside one.`).
- The welcome screen reports an import or the account dialog's outcome in a `role="status"` line under its header, and an
  import that could not be read in a `role="alert"` line there.

## 10. New-screen checklist

1. Its key, label and lucide icon in `SCREENS` and its place in `RAIL`, as a page or inside the Settings group
   (`src/app/screens.ts`); its line in `App.tsx`'s switch.
2. It opens with `PageHeader` (name, subline, toolbar); every panel is an `Island` (`air` on a reading page), every tag a
   `Chip`, every number `tabular-nums`.
3. Colours only from §5: money through `HUES`, states through the dots and chips, lime for the pressed control alone.
4. Explanations inline, errors in place, a `help.ts` key for each (i).
5. `npm run typecheck && npm run lint && npx vitest run && npm run build && npm run e2e`, then screenshots at 1440 × 900
   and 390 × 844 compared against the Statement and the Grid; extend this file in the same commit.
