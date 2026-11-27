import type { Messages } from '../en'

/** An end of an amount: the account it comes out of, or the one it goes into. */
type Way = 'out-of' | 'into'
/** How an amount meets an account that is named: "… hesabından çıkıyor", "… hesabına giriyor". */
const meets = (way: Way, account: string) => (way === 'out-of' ? `"${account}" hesabından çıkıyor` : `"${account}" hesabına giriyor`)
/** How it could meet an account of some currency: "… bir hesaptan çıkabilir", "… bir hesaba girebilir". */
const couldMeet = (way: Way) => (way === 'out-of' ? 'bir hesaptan çıkabilir' : 'bir hesaba girebilir')

export const engine: Messages['engine'] = {
  warning: {
    followsMissingRow: (row) => `"${row}" artık olmayan bir satırı izliyor.`,
    deductedFromMissingRow: (row) => `"${row}" artık olmayan bir satırdan kesiliyor.`,
    noRate: (from, to, month, name) => `${month} için ${from}→${to} kuru yok (${name})`,
    ownIncomeWithoutAdult: (row) => `"${row}" satırı, sahibi olan yetişkinin kendi gelirinin yüzdesini alıyor, ama bir yetişkine ait değil.`,
    shareOfMissingIncome: (row, month) => `"${row}" satırı artık olmayan bir gelir satırının yüzdesini alıyor (${month}).`,
    sharesOfRestOver100: 'Geriye kalanın yüzdeleri toplamda %100\'ü aşıyor.',
  },
  goal: {
    virtualAccountGone: 'Bu hedefin izlediği sanal hesap artık yok. Hedefi düzenle ve başka birini seç.',
    virtualAccountArchived: (name) => `"${name}" sanal hesabı arşivde. Hane altında geri getir ya da hedefi düzenle.`,
    accountGone: 'Bu hedefin izlediği hesap artık yok. Hedefi düzenle ve başka birini seç.',
    accountArchived: (name) => `"${name}" arşivde. Hane altında geri getir ya da hedefi düzenle.`,
    accountNotTracked: (name) => `"${name}" izlenmiyor. Hesap ayarlarında bakiyesinin izlenmesini aç.`,
  },
  mainAccount: 'Ana hesap',
  mainAccounts: 'Ana hesaplar',
  noMethod: 'Yöntem yok',
  household: 'Hane',
  thirdCurrency: {
    accountMoved: (p) =>
      `"${p.row}" satırı ${p.currency} cinsinden ve ${meets(p.way, p.account)}; bu yüzden "${p.account}" hesabı ${p.currency} ya da ${p.home} cinsinden olabilir.`,
    followedRow: (p) =>
      `"${p.row}" satırı ${p.accountCurrency} cinsinden olan ${meets(p.way, p.account)}; bu yüzden ${p.accountCurrency} ya da ${p.home} cinsinden bir satırı izleyebilir. "${p.followed}" satırı ${p.currency} cinsinden.`,
    amountMoved: (p) =>
      `"${p.row}" satırı ${p.accountCurrency} cinsinden olan ${meets(p.way, p.account)}; bu yüzden ${p.accountCurrency} ya da ${p.home} cinsinden olabilir.`,
    accountNew: (p) =>
      `"${p.row}" satırı ${p.currency} cinsinden; bu yüzden ${p.currency} ya da ${p.home} cinsinden ${couldMeet(p.way)}. "${p.account}" hesabı ${p.accountCurrency} cinsinden.`,
    betweenMoved: (p) =>
      `"${p.row}" satırı ${p.keptCurrency} cinsinden olan ${meets(p.keptWay, p.kept)} ve ${meets(p.way, p.account)}; bu yüzden "${p.account}" hesabı ${p.keptCurrency} ya da ${p.home} cinsinden olabilir.`,
    betweenNew: (p) =>
      `"${p.row}" satırı ${p.keptCurrency} cinsinden olan ${meets(p.keptWay, p.kept)}; bu yüzden ${p.keptCurrency} ya da ${p.home} cinsinden ${couldMeet(p.way)}. "${p.account}" hesabı ${p.accountCurrency} cinsinden.`,
  },
}
