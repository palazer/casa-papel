import { txt, type Messages } from '@/i18n'
import type { AccountType } from '@/model'

/**
 * Every explanation the app shows behind an (i) icon, in one place (DESIGN.md §8). The words are in the catalogue
 * (`src/i18n/en/help.ts`). Texts that belong to a model enum (section blurbs, account types, entity kinds, goal kinds)
 * stay in `src/model/templates.ts`.
 */
export interface HelpText {
  title: string
  text: string
}

export const HELP: Messages['help'] = txt.help

export type HelpKey = keyof typeof HELP

/** The balance text that fits an account, by its type; savings is the default for anything else that is tracked. */
export function balanceHelp(type: AccountType | undefined): HelpKey {
  switch (type) {
    case 'investment': return 'balance.investmentValue'
    case 'credit-card': return 'balance.cardOwed'
    case 'loan': return 'balance.loanOutstanding'
    case 'other-asset':
    case 'cash': return 'balance.otherAsset'
    case 'joint': return 'balance.currentAccount'
    default: return 'balance.savings'
  }
}
