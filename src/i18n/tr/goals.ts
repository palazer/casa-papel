import type { Messages } from '../en'

/** Goals: the dialog that sets one, and the sentence that says where one stands. */
export const goals: Messages['goals'] = {
  dialog: {
    netWorthInASentence: 'net varlık',
    notANumber: (family) => `${family === 'pay-down' ? 'Bu tutar' : 'Hedef'} okuyabildiğim bir sayı değil.`,
    editGoal: 'Hedefi düzenle',
    goalFor: (trackedName) => `Hedef: ${trackedName}`,
    newGoal: 'Yeni hedef',
    paysDownToAn: (trackedName) => `"${trackedName}" borcunu belli bir tutara indirir.`,
    netWorthReachesAn: 'Net varlık belli bir tutara ulaşır.',
    fillsToAnAmount: (trackedName) => `"${trackedName}" belli bir tutara kadar dolar.`,
    measuredAgainstThePlan: 'Her ay tablodaki plana göre ölçülür; elle güncellenecek bir şey yoktur.',
    eGEmergencyFund: 'ör. Acil durum fonu',
    tracks: 'Neyi izler',
    accountChoice: (name, tracked) => `${name}${tracked ? '' : ' (izlenmiyor)'}`,
    addACreditCard: 'Önce bir kredi kartı ya da kredi hesabı ekle.',
    addASavingsInvestment: 'Önce bir birikim, yatırım ya da diğer varlık hesabı veya bir sanal hesap ekle.',
    bringItDownTo: (currency) => `İneceği tutar (${currency})`,
    target: (currency) => `Hedef (${currency})`,
    zeroMeansNothingIs: (trackedName) => `Sıfır, ${trackedName ? `"${trackedName}" için ` : ''}hiç borç kalmadığı anlamına gelir. İlerleme, hedefi koyduğunda borçlu olunan tutardan aşağı doğru sayılır.`,
    targetMonthOptional: 'Hedef ayı (isteğe bağlı)',
    targetMonth: 'Hedef ayı',
    hasPassedTheGoal: (month) => `${month} geçti; hedef, ulaşılana kadar gecikmiş görünür.`,
    comparedWithTheMonth: 'Planın hedefe ulaştığı ayla karşılaştırılır.',
  },
  /** Where a goal stands, in one sentence. Amounts and months come written out. */
  status: {
    filling: (current, target) => `${current} / ${target}`,
    clearing: (current, start) => `${current} borç kaldı; başlangıç ${start}`,
    payingDown: (current, start, target) => `${current} borç kaldı; ${start} tutarından ${target} tutarına iniyor`,
    reachedCleared: (month) => `Borç kalmadı. Bittiği ay: ${month}.`,
    reachedDown: (target, month) => `${target} tutarına indi. Ulaşıldığı ay: ${month}.`,
    reached: (month) => `Ulaşıldığı ay: ${month}.`,
    onTrack: (where, clears, by, target) => `${where} · ${clears ? 'bitiş' : 'ulaşma'}: ${by}${target ? ` (hedef ${target})` : ''}`,
    late: (where, clears, by, target) => `${where} · ${clears ? 'bitiş' : 'ulaşma'}: ${by}, hedeften (${target}) sonra`,
    notReached: (where, horizon, target) => `${where} · önümüzdeki ${horizon} ayda ulaşılmıyor${target ? ` (hedef ${target})` : ''}`,
  },
}
