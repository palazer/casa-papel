import type { Messages } from '../en'
import { app } from './app'
import { common } from './common'
import { components } from './components'
import { data } from './data'
import { demo } from './demo'
import { engine } from './engine'
import { errors } from './errors'
import { goals } from './goals'
import { grid } from './grid'
import { guide } from './guide'
import { help } from './help'
import { home } from './home'
import { household } from './household'
import { impact } from './impact'
import { main } from './main'
import { model } from './model'
import { names } from './names'
import { past } from './past'
import { payments } from './payments'
import { recurring } from './recurring'
import { remove } from './remove'
import { rules } from './rules'
import { setup } from './setup'
import { statement } from './statement'
import { store } from './store'
import { sync } from './sync'
import { trends } from './trends'

/**
 * Every text the app shows, in Turkish (DESIGN.md §13 has the words it uses). A part that is still imported from
 * `../en` has not been written yet; the Guide's topics stay English until they are.
 */
export const tr: Messages = { app, common, components, data, demo, engine, errors, goals, grid, guide, help, home, household, impact, main, model, names, past, payments, recurring, remove, rules, setup, statement, store, sync, trends }
