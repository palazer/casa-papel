/** Goals: the dialog that sets one, and the sentence that says where one stands. */
export const goals = {
  dialog: {
    netWorthInASentence: 'net worth',
    notANumber: (family: string) => `${family === 'pay-down' ? 'That amount' : 'Target'} is not a number I can read.`,
    editGoal: 'Edit goal',
    goalFor: (trackedName: string) => `Goal for ${trackedName}`,
    newGoal: 'New goal',
    paysDownToAn: (trackedName: string) => `Pays ${trackedName} down to an amount.`,
    netWorthReachesAn: 'Net worth reaches an amount.',
    fillsToAnAmount: (trackedName: string) => `Fills ${trackedName} to an amount.`,
    measuredAgainstThePlan: 'Measured against the plan in the grid every month, nothing to update by hand.',
    eGEmergencyFund: 'e.g. Emergency fund',
    tracks: 'Tracks',
    accountChoice: (name: string, tracked: boolean) => `${name}${tracked ? '' : ' (not tracked)'}`,
    addACreditCard: 'Add a credit card or loan account first.',
    addASavingsInvestment: 'Add a savings, investment or other asset account, or a virtual account, first.',
    bringItDownTo: (currency: string) => `Bring it down to (${currency})`,
    target: (currency: string) => `Target (${currency})`,
    zeroMeansNothingIs: (trackedName: string) => `Zero means nothing is owed${trackedName ? ` on ${trackedName}` : ''}. Progress counts down from what is owed when you set the goal.`,
    targetMonthOptional: 'Target month (optional)',
    targetMonth: 'Target month',
    hasPassedTheGoal: (month: string) => `${month} has passed; the goal shows as late until it is reached.`,
    comparedWithTheMonth: 'Compared with the month the plan reaches the target.',
  },
  /** Where a goal stands, in one sentence. Amounts and months come written out. */
  status: {
    /** How far it is: a goal that fills, a debt paid off, a debt brought down to an amount. */
    filling: (current: string, target: string) => `${current} of ${target}`,
    clearing: (current: string, start: string) => `${current} still owed, down from ${start}`,
    payingDown: (current: string, start: string, target: string) => `${current} still owed, going down from ${start} to ${target}`,
    reachedCleared: (month: string) => `Nothing owed. Cleared in ${month}.`,
    reachedDown: (target: string, month: string) => `Down to ${target}. Reached in ${month}.`,
    reached: (month: string) => `Reached in ${month}.`,
    /** `where` is one of the three above; `clears`: the debt ends at zero; `target` is the target month, null without one. */
    onTrack: (where: string, clears: boolean, by: string, target: string | null) => `${where} · ${clears ? 'cleared' : 'reached'} by ${by}${target ? ` (target ${target})` : ''}`,
    late: (where: string, clears: boolean, by: string, target: string) => `${where} · ${clears ? 'cleared' : 'reached'} by ${by}, after the target of ${target}`,
    notReached: (where: string, horizon: number, target: string | null) => `${where} · not reached in the next ${horizon} months${target ? ` (target ${target})` : ''}`,
  },
}
