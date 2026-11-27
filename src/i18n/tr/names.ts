import type { Messages } from '../en'

/**
 * Names the app writes into a household. A name the household typed stands first and takes no ending: what the row
 * does follows after a dash ("Birikim – Aktarılan"), the way "Sam – Salary" is built.
 */
export const names: Messages['names'] = {
  category: {
    housing: 'Konut',
    living: 'Yaşam',
    transport: 'Ulaşım',
    family: 'Aile ve evcil hayvanlar',
    fun: 'Eğlence',
    personal: 'Kişisel',
  },
  poolRow: (pool) => `${pool} – Ayrılan`,
  rowFrom: (account) => `${account} – Çekilen`,
  rowPaysOff: (account) => `${account} – Ödeme`,
  rowTo: (account) => `${account} – Aktarılan`,
  estimateRow: (category) => `${category} – Henüz dağıtılmadı`,
  starter: { savings: 'Birikim', salary: 'Maaş', otherIncome: 'Diğer gelir', rent: 'Kira', groceries: 'Market', other: 'Diğer', toSavings: 'Birikime aktarılan' },
  starterMethod: { directDebit: 'Otomatik ödeme', standingOrder: 'Düzenli transfer', transfer: 'Elle transfer', cash: 'Nakit' },
  suggested: { mainAccount: 'Ana hesap', savings: 'Birikim' },
  topUp: {
    forPool: (pool) => `Takviye: ${pool}`,
    fromAccount: (account) => `Takviye, kaynak: ${account}`,
    fromIncome: 'Bu ayın gelirinden takviye',
  },
}
