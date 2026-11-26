import { createElement, Fragment, type ReactNode } from 'react'

/**
 * A sentence from the catalogue that has something set apart in it (a name in bold, a link): the catalogue gives its
 * parts in the order its language wants them, and this makes one node of them (DESIGN.md §13).
 */
export const sentence = (parts: ReactNode[]): ReactNode => createElement(Fragment, null, ...parts)
