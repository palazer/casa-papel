import { engine } from './engine'
import { errors } from './errors'
import { impact } from './impact'
import { model } from './model'
import { names } from './names'
import { statement } from './statement'
import { store } from './store'

/** Every text the app shows, in English. English is the source: another language's catalogue has exactly this shape. */
export const en = { engine, errors, impact, model, names, statement, store }
