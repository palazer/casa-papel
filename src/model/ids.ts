import { monotonicFactory } from 'ulid'

/** ULID: time-sortable, collision-free across devices, monotonic within a process. */
export type Id = string

const ulid = monotonicFactory()

export function newId(): Id {
  return ulid()
}

export const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/
