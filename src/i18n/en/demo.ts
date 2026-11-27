/**
 * The demo household's names (`src/demo/demoHousehold.ts`): a made-up household for the sandbox, the screenshots and
 * the Guide's examples. Its amounts, dates and ids are the same in every language; only what it is called changes,
 * and the format its numbers are written in.
 */
export const demo = {
  household: 'Demo household',
  /** The household's "Number format". */
  locale: 'en-IE',
  entity: { sam: 'Sam', alex: 'Alex', robin: 'Robin', biscuit: 'Biscuit', car: 'The car', flat: 'The flat' },
  account: { main: 'Main account', savings: 'Savings', invest: 'Index fund', card: 'Credit card' },
  category: { housing: 'Housing', living: 'Living', transport: 'Transport', family: 'Family & pets', fun: 'Fun', personal: 'Personal', transfers: 'Transfers' },
  row: {
    samSalary: 'Sam – Salary', alexSalary: 'Alex – Salary', childBenefit: 'Robin – Child benefit', otherIncome: 'Other income',
    rent: 'The flat – Rent', utilities: 'The flat – Utilities', groceries: 'Groceries', transport: 'Public transport', carInsurance: 'The car – Insurance',
    dog: 'Biscuit – Costs', childcare: 'Robin – Childcare', subscriptions: 'Subscriptions', health: 'Health', samPersonal: 'Sam – Personal',
    alexPersonal: 'Alex – Personal', travel: 'Travel', clothing: 'Clothing', cardPayment: 'Credit card – Payment',
    toSavings: 'To savings', toInvestment: 'To investments', travelAlloc: 'To Travel', clothingAlloc: 'To Clothing',
    pocketSam: 'Sam – Pocket', pocketAlex: 'Alex – Pocket',
  },
  item: {
    rent: 'Rent', streaming: 'Streaming', cloudStorage: 'Cloud storage', concertTickets: 'Concert tickets', books: 'Books', gym: 'Gym',
    weekendInLisbon: 'Weekend in Lisbon', runningShoes: 'Running shoes', soldOldBike: 'Sold old bike', winterCoat: 'Winter coat',
  },
  schedule: { rent: 'Rent', carInsurance: 'Car insurance', streaming: 'Streaming', dogTax: 'Dog tax', quarterly: 'Quarterly: Jan, Apr, Jul, Oct', yearlyInMarch: 'Yearly in March' },
  pool: { travel: 'Travel', clothing: 'Clothing' },
  method: { debit: 'Direct debit', standing: 'Standing order', transfer: 'Transfer by hand', card: 'Credit card', mainAccountNote: 'Main account' },
}
