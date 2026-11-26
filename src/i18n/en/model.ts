import type { AccountType, EntityKind, PaymentKind, RowRule, Section } from '@/model'

/**
 * The words of the model: what a kind of account, person, section, goal, rule or payment method is called and what it
 * means, the rows the app suggests, and how a schedule's rhythm is said. `src/model` builds its tables from these, so
 * the tables keep their names and shapes.
 */
type Told = { label: string; help: string }

export const model = {
  entityKind: {
    adult: { label: 'Adult', help: 'Someone with their own income or personal spending.' },
    child: { label: 'Child', help: 'Child benefit, childcare and long-term savings rows.' },
    pet: { label: 'Pet', help: 'Food, vet, insurance and tax rows.' },
    vehicle: { label: 'Vehicle', help: 'Insurance, fuel, loan or lease, maintenance rows.' },
    property: { label: 'Home', help: 'The place you live, rented or owned, or another property. Rent or mortgage, utilities, internet and insurance rows.' },
    company: { label: 'Company', help: 'A business you own. Its expenses and debt payments get their own rows.' },
    other: { label: 'Other', help: 'Anything else with running costs, like a boat or a hobby.' },
  } satisfies Record<EntityKind, Told>,
  section: {
    income: { label: 'Money in', blurb: 'What arrives during the month.' },
    expense: { label: 'Spending', blurb: 'What leaves and does not come back.' },
    transfer: { label: 'Moving money', blurb: 'From one of your accounts to another, or to a person\'s pocket. Not spending, so it is never counted as an expense.' },
  } satisfies Record<Section, { label: string; blurb: string }>,
  /** What a goal is for, as the app asks it. */
  goalKind: {
    fill: { label: 'Fill an account', help: 'A savings, investment or other asset account, or a virtual account, reaches an amount. An account is compared in its own currency.' },
    'pay-down': { label: 'Pay down a debt', help: 'A card or loan comes down to an amount, zero unless you type another. Progress counts down from what was owed when you set the goal.' },
    'net-worth': { label: 'Reach a net worth', help: 'Everything you have, what stays in the main account included, minus what you owe, in your base currency. Set it from the "Net worth" line on the Statement.' },
  },
  /** The choices under "How the amount is set", one sentence each. */
  ruleKind: {
    fixed: { label: 'A fixed amount', help: 'The same amount every month until you change it.' },
    'share-of-income': { label: 'A percentage of income', help: 'A share of the month\'s take-home income: what comes in, minus what is deducted from it. Money taken out of investments does not count.' },
    'share-of-own-income': { label: 'A percentage of their own income', help: 'Pocket money only: a share of what the adult it is for takes home, the income lines that belong to them minus what is deducted from those. An income the household shares counts for nobody.' },
    'share-of-row': { label: 'A percentage of one income', help: 'A share of one income line: what it brings in, minus what is deducted from it. When that income changes, so does this amount.' },
    'share-of-rest': { label: 'A percentage of what is left', help: 'A share of what the month has left after spending, fixed amounts, percentages of income and the cash kept in the account. Nothing in a month that overruns.' },
    rest: { label: 'The rest', help: 'Everything that is left after all of that. One account can take the rest, and the same account fills the gap in a month that overruns.' },
  } satisfies Record<RowRule, Told>,
  accountType: {
    checking: { label: 'Main account', help: 'Where salary lands and bills leave: the month\'s money runs through it. A household has one, in its own currency. Its balance is worked out from the months, and you can type what the bank says.' },
    joint: { label: 'Other current account', help: 'Another everyday account: a joint account, a partner\'s own, or one in another currency. It has a balance of its own under Other assets: a transfer row moves money into it, and an expense can come out of it.' },
    savings: { label: 'Savings', help: 'Where the month\'s leftover goes. The balance is tracked month by month, and virtual accounts live inside it.' },
    investment: { label: 'Investments', help: 'Broker, fund or pension account. Deposits and value are tracked.' },
    'credit-card': { label: 'Credit card', help: 'A debt you carry on a card. Each payment brings it down, and once a month you type what the statement says. A card you pay off in full every month needs no account: what you buy with it is in your rows already, and a payment method can say it was the card.' },
    loan: { label: 'Loan', help: 'Money you owe. Payments bring the outstanding amount down.' },
    'other-asset': { label: 'Other asset', help: 'Something you own with a value, like a rental deposit. Counts towards net worth.' },
    cash: { label: 'Cash', help: 'Money you hold as cash, at home or in a wallet. It has a balance of its own under Other assets, and an expense can come out of it.' },
  } satisfies Record<AccountType, Told>,
  paymentKind: {
    'direct-debit': { label: 'Direct debit', help: 'Collected from the account by whoever is paid (SEPA). The money has to be there on the day.' },
    'standing-order': { label: 'Standing order', help: 'Sent by the bank on a fixed day. The money has to be there on the day.' },
    transfer: { label: 'Transfer by hand', help: 'A transfer you make yourself each time.' },
    'debit-card': { label: 'Debit card', help: 'A card that takes the money from its account when you pay.' },
    'credit-card': { label: 'Credit card', help: 'Paying with a credit card. A label like every method: what you owe on a card is followed on the card\'s account, by what you pay to it and what its statement says.' },
    wallet: { label: 'Wallet', help: 'PayPal, Apple Pay and the like.' },
    cash: { label: 'Cash', help: 'Notes and coins.' },
    other: { label: 'Other', help: 'Any other way of paying.' },
  } satisfies Record<PaymentKind, Told>,
  /**
   * The rows the app suggests, by the key of the suggestion. `{name}` in a title is replaced with the name of the person
   * or thing the row is for. A title becomes the row's name, which is stored.
   */
  templates: {
    'h.otherIncome': { title: 'Other income', description: 'Refunds, gifts, side income that is nobody\'s salary.' },
    'h.groceries': { title: 'Groceries', description: 'Food and everyday supplies.' },
    'h.transport': { title: 'Transport', description: 'Public transport, taxis, bike.' },
    'h.subscriptions': { title: 'Subscriptions', description: 'Streaming, phone, software. Counted as certain.' },
    'h.health': { title: 'Health', description: 'Doctor, pharmacy, glasses.' },
    'h.gym': { title: 'Gym & sports', description: 'Memberships and sports.' },
    'h.insurance': { title: 'Insurance & tax', description: 'Liability and household insurance, taxes not tied to a car or home.' },
    'h.other': { title: 'Other', description: 'Whatever fits nowhere else. Treated as an estimate.' },
    'h.poolTravel': { title: 'Travel', description: 'Virtual account: set aside a monthly amount in savings, spend it when you travel.' },
    'h.poolClothing': { title: 'Clothing', description: 'Virtual account: a monthly amount set aside for clothes.' },
    'h.poolFun': { title: 'Entertainment & dining out', description: 'Virtual account: a monthly amount set aside for going out.' },
    'h.toSavings': { title: 'To savings', description: 'What is left at month end moves to savings. Filled in automatically unless your month-end rule says you decide it.' },
    'h.toInvestments': { title: 'To investments', description: 'A fixed monthly deposit into an investment account.' },
    'a.salary': { title: '{name} – Salary', description: 'Net salary after tax. Counted as certain.' },
    'a.extra': { title: '{name} – Extra income', description: 'Bonuses, freelance work, side income.' },
    'a.personal': { title: '{name} – Personal', description: 'Own spending the household pays for, like a phone contract or a membership.' },
    'a.pocket': { title: '{name} – Pocket', description: 'Money this adult spends freely each month: an amount you type, or a percentage once the line has a rule.' },
    'c.benefit': { title: '{name} – Child benefit', description: 'State child benefit or allowance.' },
    'c.care': { title: '{name} – Childcare & school', description: 'Daycare, school fees, clubs.' },
    'c.gear': { title: '{name} – Gear & clothes', description: 'Clothes, toys, equipment.' },
    'c.longterm': { title: '{name} – Long-term savings', description: 'A monthly deposit into an investment account kept for the child.' },
    'p.insurance': { title: '{name} – Insurance', description: 'Pet liability or health insurance.' },
    'p.tax': { title: '{name} – Tax', description: 'Pet tax or licence where it applies.' },
    'p.food': { title: '{name} – Food & supplies', description: 'Food, litter, toys.' },
    'p.vet': { title: '{name} – Vet', description: 'Check-ups and treatment.' },
    'v.loan': { title: '{name} – Loan or lease', description: 'The monthly car loan or lease payment. Linked to a loan account, it brings the outstanding amount down.' },
    'v.insurance': { title: '{name} – Insurance', description: 'Car insurance.' },
    'v.tax': { title: '{name} – Tax & inspection', description: 'Road tax and the periodic inspection.' },
    'v.fuel': { title: '{name} – Fuel & parking', description: 'Fuel or charging, parking, tolls.' },
    'v.maintenance': { title: '{name} – Maintenance', description: 'Service, tyres, repairs.' },
    'r.rent': { title: '{name} – Rent or mortgage', description: 'The monthly rent or mortgage payment.' },
    'r.utilities': { title: '{name} – Utilities', description: 'Electricity, gas, water, heating.' },
    'r.internet': { title: '{name} – Internet & phone', description: 'Home internet, landline, TV licence.' },
    'r.improvement': { title: '{name} – Home improvement', description: 'Furniture, repairs, decoration.' },
    'r.insurance': { title: '{name} – Home insurance', description: 'Contents or building insurance.' },
    'k.expenses': { title: '{name} – Company expenses', description: 'What the business costs you each month.' },
    'k.debt': { title: '{name} – Company debt payments', description: 'Repayments on money the company owes. Linked to a loan account, it brings the debt down.' },
    'o.costs': { title: '{name} – Costs', description: 'Running costs of this thing.' },
  },
  /** How a schedule repeats, in the words the app uses for it everywhere. `months` are short month names, joined. */
  cadence: {
    everyMonth: 'Every month',
    everyYear: (month: string) => `Every year (${month})`,
    everyMonths: (n: number, months: string) => `Every ${n} months (${months})`,
    inMonths: (months: string) => `In ${months}`,
    itemsRepeat: (n: number) => `${n} items repeat`,
  },
  /** What the rules of a household's rows have to say when two of them want the same thing. */
  rules: {
    bothTakeRest: (first: string, second: string) => `"${first}" and "${second}" are both set to take the rest; "${first}" takes it.`,
    severalToSavings: 'More than one "to savings" row: the plug goes to the first one.',
  },
  /** A file from a newer version of the app. */
  newerFile: (version: number) => `This file was made by a newer Casa Papel (schema ${version}). Update the app to import it.`,
}
