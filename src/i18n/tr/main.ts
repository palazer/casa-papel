import type { Messages } from '../en'

/** The question about the one main account. */
export const main: Messages['main'] = {
  question: {
    whichIsYourMain: 'Ana hesabın hangisi?',
    oneMainAccount: 'Tek ana hesap',
    theMonthsMoneyNow: (base) => `Ayın parası artık tek bir hesaptan geçiyor; para birimi ${base}. Diğerleri kendi bakiyesini tutar: onlara para bir transfer satırıyla taşınır ve giderler onlardan çıkabilir.`,
    mainAccount: 'Ana hesap',
    whatChanges: 'Neler değişir',
    isTheMainAccount: (name) => `Ana hesap: "${name}".`,
    noneOfThemIs: (base) => `Hiçbirinin para birimi ${base} değil: sen bir tane ekleyene kadar ayın parası "Ana hesap" satırında kalır.`,
    isInItKeeps: (name, currency) => `"${name}" hesabının para birimi ${currency}: kendi bakiyesini tutar ve değeri kurla birlikte oynar.`,
    netWorthStays: (foreign) => (foreign ? 'Net varlık, kurun etkisi dışında olduğu gibi kalır.' : 'Net varlık olduğu gibi kalır.'),
    ok: 'Tamam',
  },
}
