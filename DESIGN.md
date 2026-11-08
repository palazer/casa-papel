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
Reading page     mx-auto max-w-3xl space-y-4 text-xs of air islands (Household, Data, Moves)
Phone list       mx-auto max-w-xl space-y-4 of dense islands, rows text-sm and min-h-11 (the Month view)
```

- **Rail** (`src/components/AppRail.tsx`, after FantasyPros' and nfl's): a `<nav aria-label="Screens">`, 72 px, one
  column: the household's monogram (two letters in a 40 px circle with a lime ring; `demo` chip under it in the sandbox;
  its accessible name is always `Casa Papel`, the household's name is only its tooltip, so no screen's name can hide in
  it and `getByRole('link', { name: 'Household' })` stays unambiguous), then one tile per screen: a 40 × 30 `rounded-lg` tile holding a 20 px lucide icon over a `text-[10px] font-semibold`
  label. The open screen's tile is `bg-primary text-primary-foreground` with `aria-current="page"`; the others are
  `text-white/70`, hover `bg-white/10`. Items are real links (`?screen=…`, every other parameter kept, so `?demo=1`
  survives); a plain click opens in place, Cmd-click opens a tab.
- **Bottom tabs** (`src/components/BottomTabs.tsx`): the same five tiles as a bar along the bottom edge, 56 px tall plus
  the safe-area inset, `md:hidden`.
- **Screen state** (`src/app/screens.ts`): `?screen=` wins, then the screen open last (`casa.screen`), then the device's
  natural first screen (Month on a phone, Grid otherwise). `rememberScreen` writes both; the address bar follows through
  `history.replaceState`, so Back never walks through screen changes. Data is never remembered as the screen to land on:
  it is a utility, so a fresh visit opens the household (or the welcome screen when there is none).
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
  in with no household it skips straight to the wizard with a "Signed in as …" line and no chooser; a locked or undecided
  cloud copy offers Open Data instead of the wizard. The wizard's title row carries "Back to start" while the chooser exists.
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

- `tone={HUES.x}` colours the title in a kind-of-money hue: Income / Expenses / Transfers lists, Accounts (worth), Pool
  accounts (pool), Schedules and Transfers to make (transfer), Payments due (expense). Mixed panels stay ink. Goals keep
  an ink title; their gold lives in the bars.
- `description` is the one sentence that explains the panel (Casa Papel explains every option inline). `right` holds a
  count or a small control, `toolbar` a non-scrolling filter row, `tabs` a `TabBar` in place of the title, `onFold` a
  caret that minimizes the island.
- Dense islands for the phone's Month view and small stat panels; air islands for reading pages (Household, Data, Moves,
  the setup wizard). Titles are sentence case with facts after a middle dot.

## 4. Typography

| Class | Use |
|---|---|
| `text-2xl font-semibold leading-8 tracking-tight` | the page header's H1 only |
| `text-sm font-medium leading-5` | air island titles, the month in the toolbar, one emphasised value |
| `text-sm` | the phone's Month view rows and its stats (14 px, the one place desktop density does not apply) |
| `text-xs` | body text inside every panel, table and toolbar on desktop; the grid |
| `text-[11px] leading-[15px]` | the muted meta line under a title or row |
| `text-[10px]` | chips, small-caps island titles, the Σ line under a row name, rail labels |

Weights: `font-medium` for names, `font-semibold` for headers and section titles, `font-bold` nowhere. Numbers are
right-aligned and `tabular-nums`; money keeps its cents; missing renders `—` or a muted `·` in an empty grid cell.
Truncation idiom: a `min-w-0` parent, `truncate` on the name, `shrink-0` on siblings.

## 5. Colour semantics

- **Kinds of money** (tokens, §1): section titles and total-row labels in the hue; total rows on their `tint`; spending
  amounts in the expense hue when "show expenses as negative" is on; money taken back out of savings in `--draw`. Numbers
  otherwise stay ink, so the grid never becomes a heat map. A balance below zero (an overdrawn pool account, savings in the
  red, negative net worth) is in the expense hue whatever the negatives setting: it is a warning, not spending.
- **Certainty**: an estimate is italic with a dashed `decoration-partial` underline; certain and done are plain.
- **Done**: one mark only, the `DoneDot` (8 px): a green disc for done in any month; in the current open month also a
  red ring for nothing done and an amber half disc for partly done.
- **Chips** (`src/components/ui/chip.tsx`, `rounded px-1.5 leading-4 text-[10px] font-medium`): zinc a neutral fact or
  idle (`closed`, `automatic`, an account or entity type, `ECB`, `carried`), emerald done or good (`paid`), amber a warning
  or an estimate (`due`, `demo`, `projected`, storage may be evicted), rose missing or late (`missing`), sky information
  or something of yours (`manual` rate, `using +1.50%`), violet a second party. An `outline` variant exists for a
  blocker. Chip copy is lowercase.
- **Lime** (`--primary`): the pressed control only (§1). Never a status.
- **Closed months**: the column's cells on `bg-muted/60`, a lock before the month name, `closed` chip in the sublines.
- **Adjusted balances** (a real balance entered): a dotted underline on the amount.
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
- A cell in another currency is two lines: the typed amount over a `text-[10px] leading-3` muted `≈ €3,120` in the household
  currency at that month's rate (the cell button becomes `flex-col items-end`; the certainty styling stays on the amount
  line; the `aria-label` says `, about €3,120`). The label keeps the currency code, a follower's too. A foreign account's
  balance row has a muted `in EUR` sub-row like `Deposited`; the Month view's stat shows `≈ €…` after the balance.
- An income cell with deductions shows `net €2,775` as its second line in place of the `≈` line (`aria-label` `, net
  €2,775`). A deduction row's label carries the muted tag `out of <income>` with an (i); a follower that takes a share
  reads `= 25% of <row>`. The cell editor of such an income lists the deductions in a `rounded-md border` block
  (`data-testid="deductions"`, each `−€…`, then a Net line) above the error line.
- "Add row" at a section's foot is inline (`src/features/grid/AddRowInline.tsx`): a name and, when the section has any,
  a category. Under Transfers it also asks what the row does (moves money between your accounts, goes into a savings
  account, deposits into an investment account, fills a pool account that lost its row, pocket money for an adult), with
  a second select for the target and one muted sentence under the controls for the chosen kind. A choice without a
  possible target is left out (a second "to savings" under the savings plug, a pool row when every pool account has one)
  or the sentence says what to add first and Add is disabled. The store checks the same rules (`addTransferRow`).
- Section header rows: the chevron and the title in `text-xs font-semibold` in the section's hue; no bar, no fill.
- Categories (`groupRowsByCategory`): inside a section rows sort by category, then by their own order; rows without
  one come last. When the section has categories, each group opens with a label row (`text-[10px] font-semibold
  uppercase tracking-wider text-muted-foreground`, `No category` for the rest) and every other named group sits on the
  section hue's `band` (a 5 % mix, opaque, so sticky label cells can carry it too); the uncategorised group never does.
  The closed-month grey stays a translucent overlay on the cells, so it reads over a band. The Month view shows the same
  label lines, without bands.
- Total rows (`derivedRow` with `band`): the label in the hue on the hue's `tint`, `font-medium`; detail lines under an
  investment account (`Deposited`, `Return`) indented and `text-[11px]` muted.
- Keyboard: arrows move between cells (`data-cell="row,col"`), Enter or Space opens the editor.

## 7. Rows, lists, tables and tiles

- **List rows inside an island**: `divide-y divide-border/60`, `py-1` to `py-1.5`, a chip for the type, the name in
  `font-medium`, muted facts after it, actions as `xs` buttons at `ml-auto`. No outer border around a list that is the
  island's whole body.
- **Tables** (Schedules, Who pays what, rates): `w-full`, header cells `px-1.5 py-1 font-semibold text-muted-foreground`,
  body cells `px-1.5 py-0.5`, rows separated by `divide-border/60`; a table that is not the island's whole body sits in
  `rounded-md border`. No zebra striping.
- **Stat tiles** (`src/components/ui/stat-tile.tsx`): a small-caps label (in a kind-of-money hue when the number is one)
  over `text-sm font-semibold tabular-nums`, in `rounded-md border` boxes laid out `grid grid-cols-2 gap-2 sm:grid-cols-5`.
- **Month lines** (`src/features/month/MonthLine.tsx`): `grid grid-cols-[minmax(0,1fr)_2.75rem]`, a `min-h-11 px-3
  py-2 text-sm` body (the name, a muted subline for `= Followed`, `= 25% of Followed`, `automatic`, `2 of 3 done`, `≈ €3,120` or
  `net €2,775`, the amount at the end)
  and the `Tick` in the right column. The body of an itemized line opens its items as an accordion (`aria-expanded`,
  items on `bg-muted/20` indented `pl-9`, a `Repeat` icon for scheduled ones, each with its own tick); any other body
  opens the Paid sheet; an automatic line's body is plain text with an (i). Above the islands, `ProgressLine`: an
  `aria-live` text (`7 of 21 done · €… still to pay · €… to come in`, `All 21 done`, `Closed · all done`) and a small
  `Hide done` switch; a section whose lines are all hidden says `All done`.
- **Progress bars** (goals): `h-2 rounded-full bg-goal-tint` with a `bg-goal` fill, `bg-income` once reached.

## 8. Controls

- Buttons: `size="sm"` (28 px) for a toolbar's one primary action (`Close month`, `Export now`), `size="xs"` (24 px) for
  everything else in toolbars, lists and islands, `icon-xs` for icon buttons in toolbars. Dialog footers keep the default
  size. Variants: `default` (lime) for the primary action or the active toggle, `outline` for the rest and inactive
  toggles, `ghost` for quiet actions (Edit, Cancel), `destructive` for the irreversible. Toggle idiom:
  `variant={active ? 'default' : 'outline'}` (the entity-kind picker under People & things).
- `MonthPicker`: two `icon-xs outline` buttons around the month as an `h2 text-sm font-medium`; lives in the page
  header's toolbar (Month, Moves) or an island's first line (Schedules). At the last planned month the Next button gives
  way to an `xs outline` `Add <year>`, the Grid toolbar's action: the plan always ends in a December and grows a calendar
  year at a time (`planEnd` in `src/store/months.ts`; this year's December, next year's from October on).
- Rates are always spelled with both codes in the orientation whose number is ≥ 1 (`1 EUR = 1.08 USD`, `1 USD = 48.58 TRY`;
  `readableRate` in `src/features/household/fxDisplay.ts`); the rates table's columns read `1 EUR in USD` and store
  `base/foreign`. The cell editor's rate line (`src/features/grid/RateLine.tsx`) sits under an amount in another currency:
  `≈ €3,120.00 · 1 EUR = 1.084 USD · [ECB] 2 Nov 2026` with the table's chip tones, a ghost `xs` "Change this month's
  rate…" that reveals an inline input (one rate per currency per month), and "Use the ECB rate again" while the rate is
  manual. The ECB day is the Month rate setting's, the first business day by default.
- A row's menu (`src/features/grid/RowMenu.tsx`) runs Rename…, Move up, Move down, Category…, Belongs to…, Currency…,
  then Treat new values as…, Comes out of…, Deducted from an income… (spending rows, followers included; it names the
  income once set), the account verb, Follow another row…, then Archive or delete… or Restore. Belongs to offers the
  household, an Adults group and an Other people & things group (`name · kind`), plus a "Counts for the split" check on
  income rows (disabled while shared); Deducted from lists the live income rows after "Nothing: a normal expense";
  Follow another row shows "Share (%)" once a row is chosen (100 mirrors it). Each dialog's help sentence is the
  `HELP` text of its field, so the (i) and the explanation never drift apart.
- `TabBar` switches an island's view (`src/components/ui/tab-bar.tsx`); `ViewToggle` filters a list
  (`src/components/ui/view-toggle.tsx`); `Segmented` stays for a form field with a few options (certainty, applies to).
- Native `<select>` through `NativeSelect` for form fields; `MonthField` for months (Safari has no month input).
- Checkboxes are the native `Check` (16 px) in lists that tick things off (Moves). The Month view's `Tick`
  (`src/components/Tick.tsx`) is a `role="checkbox"` button of 44 × 44 px whose face is the `DoneDot` at 20 px
  (`aria-checked` true, `mixed` or false), named `<line> done`; one tap marks done, a second tap goes back to the row's
  default. Automatic rows (the savings plug, pocket shares, followers) tick through `Cell.markedDone`; Moves shows the
  same tick before their `automatic` chip.
- The Paid sheet (`src/features/month/PaidSheet.tsx`) is the shadcn `Dialog` docked to the bottom edge under 640 px
  (`SHEET_CLASS`: `max-sm:bottom-0 … rounded-t-2xl` with safe-area padding): amount, date (today in the current month),
  certainty as a `Segmented` with Done preselected, note, then `Open full editor`, Cancel and Save. Saving changes this
  month only.
- Dialogs are shadcn `Dialog`; the confirm step lives inside the dialog, never behind it. Errors appear beside the field
  that caused them, `role="alert"`.
- Removing anything goes through one `RemoveDialog` (`src/features/remove/RemoveDialog.tsx`), reached from a row's
  menu ("Archive or delete…"), the People & things list, the account, pool account and goal dialogs' footers
  ("Archive or delete…", "Delete…"), the schedules list, the cell editor's "All occurrences" and the Categories card.
  Title `<Kind> "<name>"`, then an Archive section (a `MonthField` "Archive from" with an (i), what changes from that
  month, "Earlier months stay exactly as they are") and a Delete section ("Deleting removes", "Also changes", a note,
  and blockers in a destructive `Alert` "Resolve these first" that says where to fix each). When the thing has amounts
  in a closed month the Delete section is one sentence saying so, and only Archive remains; an archive month inside
  that history is refused beside the field. Footer: Cancel, `Archive from <month>` (`outline`, `default` when it is
  the only choice), `Delete` (`destructive`, disabled with blockers). The words and the write come from the same scan
  (`describeRemoval` and `planRemoval`/`planArchive` in `src/store/impact.ts`), so they cannot disagree, and every
  removal is one undoable commit ("You can undo this right after"). Archived things are listed with Restore under
  Household: Archived rows, and an Archived line in Accounts, Pool accounts and People & things.
- Help is one mechanism: `InfoTip` (`src/components/InfoTip.tsx`), a 16 px (i) in `text-muted-foreground/70` (24 px
  where the pointer is a finger) that opens a `w-64 text-xs` popover on hover after 150 ms and on tap, and closes when
  the mouse leaves, on Escape or on a click outside. Its accessible name is `About <title>`. It is a sibling of the thing
  it explains, never inside a `<label>`, `<button>`, `<legend>` text or menu item (in Playwright, a field with a tip is
  found with `getByLabel(name, { exact: true })`, since the (i)'s name contains the field's): `TipLabel` pairs a form label with one,
  `Island`, `StatTile`, the Month view's `Stat` and the grid's `derivedRow` take a `help` key, the grid's row label puts
  it between the name and the row menu. Where it goes: section titles, every total and balance the app works out,
  automatic and following rows, stat labels, the cell editor's "Applies to", "How sure", "Comes out of", its rate line and its deductions block, a row's currency, who a row belongs to, what it is deducted from and its share of a followed row, the `in EUR` balance line, the
  household settings, "Track the balance", the Archived list, Goals and the schedules' status column.
- Every text lives in `src/app/help.ts`: `HELP[key] = { title, text }`, keys `area.name`, titles up to 40 characters,
  texts two or three plain sentences up to 360 characters in the app's own words (pool accounts, people & things,
  schedules, automatic). `balanceHelp(type)` picks the balance text for an account. Texts that belong to a model enum
  (section blurbs, account types, entity kinds, goal kinds) stay in `src/model/templates.ts`; the wizard's rule and
  mode lines (`RULE_HELP`, `MODE_HELP`, `BASIS_HELP`) stay inline because their words depend on the choice.
- `MarksLegend` ("What the colours and marks mean", an `xs outline` button in the Grid and Month toolbars) is the legend:
  the six hue dots with their kinds of money, then the marks with a sample each: estimate, certain, done, this month's
  red and amber dots, the negative spending number when that setting is on, the amber draw, the dotted entered balance,
  the locked closed month.

## 9. Loading, errors, empty

- Loading is nothing (the store is local; `useLiveQuery` resolves within a frame), never a spinner.
- An action that failed shows a `role="alert"` line in `text-destructive` in the page header's toolbar or beside the
  control; an engine warning is `text-amber-700`. Data-screen outcomes use the `Alert` block.
- Empty states are one muted sentence that says what to do (`Nothing to transfer.`, `Add a savings account first; pool
  accounts live inside one.`).
- The welcome screen reports an import or the account dialog's outcome in a `role="status"` line under its header, and an
  import that could not be read in a `role="alert"` line there.

## 10. New-screen checklist

1. Its key, label and lucide icon in `SCREENS` (`src/app/screens.ts`); its line in `App.tsx`'s switch.
2. It opens with `PageHeader` (name, subline, toolbar); every panel is an `Island` (`air` on a reading page), every tag a
   `Chip`, every number `tabular-nums`.
3. Colours only from §5: money through `HUES`, states through the dots and chips, lime for the pressed control alone.
4. Explanations inline, errors in place, a `help.ts` key for each (i).
5. `npm run typecheck && npm run lint && npx vitest run && npm run build && npm run e2e`, then screenshots at 1440 × 900
   and 390 × 844 compared against the Grid and the Month view; extend this file in the same commit.
