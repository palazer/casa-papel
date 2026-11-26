/** The question before a change reaches months that are over. */
export const past = {
  question: {
    thisChangesMonthsThat: 'This changes months that are over',
    monthsChange: (months: string, count: number) => `${months} ${count === 1 ? 'changes' : 'change'}:`,
    whatChanges: 'What changes',
    onlyFromOn: (month: string) => `Only from ${month} on`,
    saveAnyway: 'Save anyway',
  },
}
