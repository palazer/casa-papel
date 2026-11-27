import type { Messages } from '../en'

/** The question before a change reaches months that are over. */
export const past: Messages['past'] = {
  question: {
    thisChangesMonthsThat: 'Bu, geçmiş ayları değiştirir',
    monthsChange: (months) => `${months} değişiyor:`,
    whatChanges: 'Neler değişir',
    onlyFromOn: (month) => `Yalnızca ${month} ve sonrası`,
    saveAnyway: 'Yine de kaydet',
  },
}
