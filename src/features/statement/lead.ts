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
/**
 * The other half of a hanging indent: on a line whose name carries its own arrow (and tick's place), the name's box
 * reaches back over that padding to the line's edge, so the arrow keeps its column while everything that wraps to a
 * second line starts under the name. It may be as wide as the line again, the padding included.
 */
export const LEAD_HANG = {
  ticks: '-ml-[4.375rem] max-w-[calc(100%_+_4.375rem)] md:-ml-[3.125rem] md:max-w-[calc(100%_+_3.125rem)]',
  plain: '-ml-5 max-w-[calc(100%_+_1.25rem)]',
} as const
/**
 * A part of the page the guided setup has not come to yet (DESIGN.md §7): dimmed, and `inert` with it, so it can
 * neither be pressed nor reached with the keyboard until its step.
 */
export const LOCKED = 'opacity-40 saturate-50'
/** What an add control's button needs so that its lead and its text sit on those columns; the button's own 1 px border is taken back. */
export const LEAD_BUTTON = '-ml-px gap-1.5 pl-0 pr-2'
