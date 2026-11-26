import { app } from './app'
import { engine } from './engine'
import { errors } from './errors'
import { guide } from './guide'
import { help } from './help'
import { impact } from './impact'
import { model } from './model'
import { names } from './names'
import { statement } from './statement'
import { store } from './store'

/** Every text the app shows, in English. English is the source: another language's catalogue has exactly this shape. */
export const en = { app, engine, errors, guide, help, impact, model, names, statement, store }
