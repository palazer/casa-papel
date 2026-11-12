/**
 * The columns a line of the Statement has before its name (DESIGN.md §7), in one place so that the lines and the add
 * controls under them cannot drift apart: the arrow's slot, then, among rows that are ticked, the tick's.
 */
export const CHEVRON_SLOT = 'flex w-3.5 shrink-0 items-center justify-center self-stretch'
export const TICK_SLOT = 'size-11 shrink-0 md:size-6'
/** As wide as the tick, with no height of its own: the place a tick would take on a line that has none. */
export const TICK_GAP = 'w-11 shrink-0 md:w-6'
/**
 * The same columns as left padding, for an open form that starts on the names' column: the arrow (14 px) and its gap
 * (6 px), and among ticked rows the tick (44 px, 24 px from `md`) and its gap.
 */
export const LEAD_PAD = { ticks: 'pl-[4.375rem] md:pl-[3.125rem]', plain: 'pl-5' } as const
/** What an add control's button needs so that its lead and its text sit on those columns; the button's own 1 px border is taken back. */
export const LEAD_BUTTON = '-ml-px gap-1.5 pl-0 pr-2'
