import type { Messages } from '../en'

/**
 * What removing, archiving or restoring something would do, in whole sentences (`src/store/impact.ts`). Turkish takes
 * no plural after a number and leaves the verb as it is for several things, so most sentences need no second form.
 * A month is followed by "ayından itibaren" or "ayında", so its name takes no ending.
 */

const pick = (n: number, one: string, many: string): string => (n === 1 ? one : many)

/** `"A"`, `"A" ve "B"`, `"A", "B", "C" ve "D"`, `"A", "B", "C", "D" ve 2 tane daha`. */
function quoteNames(names: string[], max = 4): string {
  const q = names.map((n) => `"${n}"`)
  if (q.length <= 1) return q[0] ?? ''
  if (q.length <= max) return `${q.slice(0, -1).join(', ')} ve ${q[q.length - 1]}`
  return `${q.slice(0, max).join(', ')} ve ${q.length - max} tane daha`
}

const schedulesNamed = (names: string[]): string => (names.length === 1 ? `Düzenli kalemi ${quoteNames(names)}` : `${names.length} düzenli kalemi (${quoteNames(names)})`)
/** Where spending comes out of once its virtual account is gone: the account that held it, or the month's income. */
const instead = (holder: string | null): string => (holder == null ? 'ayın gelirinden' : `"${holder}" hesabından`)
const outOf = (source: string | null): string => (source == null ? 'ondan' : `"${source}" içinden`)

export const impact: Messages['impact'] = {
  quoteNames,
  kind: { row: 'Satır', account: 'Hesap', pool: 'Sanal hesap', schedule: 'Düzenli kalem', goal: 'Hedef', category: 'Kategori' },
  gone: {
    row: 'Bu satır artık yok.', account: 'Bu hesap artık yok.', pool: 'Bu sanal hesap artık yok.',
    entity: 'Bu kişi ya da şey artık yok.', schedule: 'Bu düzenli kalem artık yok.', goal: 'Bu hedef artık yok.', category: 'Bu kategori artık yok.',
  },
  over: (n, counted, span) => `${counted ? 'Bu aylardan' : 'Aylarından'} ${n} tanesi geçmiş (${span}): ${pick(n, 'o da değişir', 'onlar da değişir')}`,
  archiveNotBefore: (month) => `Hanenin ilk ayı ${month}: o aydan ya da daha sonrasından itibaren arşivle.`,
  resolveFirst: (blockers) => `Önce şunu çöz: ${blockers.join('; ')}.`,
  cannotArchiveDelete: (kind) => `Bir ${kind} arşivlenemez. Onun yerine sil.`,
  cannotArchive: (kind) => `Bir ${kind} arşivlenemez.`,
  neverArchived: (kind) => `Bir ${kind} hiç arşivlenmez; geri getirilecek bir şey yok.`,

  row: {
    losesAmounts: (months, span) => `${months} aydaki tutarları (${span})`,
    losesSchedules: (names) => schedulesNamed(names),
    followersKeepOwn: (names) => `${quoteNames(names)} onu izlemeyi bırakır ve kendi tutarlarını korur`,
    deductionsOrdinary: (names) => `${quoteNames(names)} artık ondan kesilmez ve olağan harcama sayılır`,
    sharersGetNothing: (names) => `${quoteNames(names)} onun bir yüzdesini alıyor; başka bir kural seçilene kadar hiçbir şey almaz`,
    poolNotFilled: (pool) => `"${pool}" sanal hesabı artık her ay doldurulmaz`,
    noLeftover: (account) => `"${account}" artık ayın arta kalanını almaz`,
    archive: {
      hidden: (at, laterMonths) => (laterMonths ? `${at} ayından itibaren gizlenir; sonraki ${laterMonths} aydaki tutarları artık sayılmaz` : `${at} ayından itibaren gizlenir`),
      schedulesStop: (names, after) => `${schedulesNamed(names)} ${after} ayından sonra durur`,
      followersKeepLast: (names, at) => `${quoteNames(names)} onu izlemeyi bırakır; ${at} ayından itibaren son tutarı kendi tutarı olarak korur`,
      deductionsOrdinary: (names, at) => `${quoteNames(names)} ${at} ayından itibaren artık ondan kesilmez ve olağan harcama sayılır`,
      sharersGetNothing: (names, at) => `${quoteNames(names)} onun bir yüzdesini alıyor; ${at} ayından itibaren, başka bir kural seçilene kadar hiçbir şey almaz`,
      poolNotFilled: (pool, at) => `"${pool}" sanal hesabı ${at} ayından itibaren artık doldurulmaz`,
      noLeftover: (account, at) => `"${account}" ${at} ayından itibaren artık ayın arta kalanını almaz`,
    },
  },

  losesGoals: (goals) => `Onu izleyen ${pick(goals.length, 'hedef', 'hedefler')}: ${quoteNames(goals)}`,
  goalsUnmeasured: (goals) => `Artık ölçülemeyen ${pick(goals.length, 'hedef', 'hedefler')}: ${quoteNames(goals)}`,

  account: {
    losesRealBalances: (n, span) => `Girdiğin ${n} gerçek bakiye (${span})`,
    blocker: {
      sends: (row) => `"${row}" ona para gönderiyor`,
      takes: (row) => `"${row}" ondan para alıyor`,
      paysOff: (row) => `"${row}" onu ödüyor`,
      uses: (row) => `"${row}" onu kullanıyor`,
      rowWhere: 'Tablodaki satır menüsünden satırı başka bir hesaba yönelt ya da satırı arşivle.',
      holdsPool: (pool) => `"${pool}" sanal hesabı onun içinde tutuluyor`,
      poolWhere: 'Hane → Sanal hesaplar → Düzenle altından onu başka bir birikim hesabına taşı ya da arşivle.',
    },
    noLongerNamed: (names, paying) => `${quoteNames(names)} artık onu ${paying ? 'ödeyen hesap olarak ' : ''}göstermez`,
    schedulesNoLongerName: (n) => `${n} düzenli kalem artık onu göstermez`,
    fundedFromIncome: (names) => `${quoteNames(names)} bunun yerine ayın gelirinden çıkar`,
    paidFromIncome: (months) => `${months} ayda ondan çıkanlar o ayın gelirinden harcanmış sayılır; bu yüzden oradaki arta kalan düşer`,
    schedulesFromIncome: (n) => `${n} düzenli kalem bunun yerine ayın gelirinden çıkar`,
    archive: {
      balanceStops: (last, at) => `Bakiyesi ${last} ayında durur; ${at} ayından itibaren gizlenir ve artık net varlığa sayılmaz`,
      hidden: (at) => `${at} ayından itibaren gizlenir; onu gösteren satırlar çalışmaya devam eder`,
      typedKeepMoving: (names, at) => `${quoteNames(names)} para taşımaya devam eder, ama ${at} ayından itibaren bakiye artık izlenmez`,
      poolsArchived: (names, at) => `${pick(names.length, 'Sanal hesabı', 'Sanal hesapları')} ${quoteNames(names)} ${at} ayından itibaren onunla birlikte arşivlenir`,
      moversFromIncome: (names, at) => `${at} ayından itibaren ${quoteNames(names)} ayın gelirinden çıkar; önceki aylar kaynak olarak hesabı korur`,
    },
  },

  pool: {
    losesBalance: (span) => `Bakiyesi${span ? ` (${span})` : ''}`,
    losesRow: (row, months) => `Onu dolduran "${row}" satırı${months ? `; ${months} aydaki tutarlarıyla birlikte` : ''}`,
    fundedInstead: (names, holder) => `${quoteNames(names)} bunun yerine ${instead(holder)} çıkar`,
    spendingInstead: (months, holder) => `${months} ayda ondan çıkan harcamalar ${instead(holder)} harcanmış sayılır`,
    schedulesInstead: (n, holder) => `${n} düzenli kalem bunun yerine ${instead(holder)} çıkar`,
    archive: {
      balanceStops: (last) => `Bakiyesi ${last} ayında durur`,
      rowArchived: (row, at) => `"${row}" ${at} ayından itibaren arşivlenir; artık bir şey ayrılmaz`,
      moversInstead: (names, at, holder) => `${at} ayından itibaren ${quoteNames(names)} ${instead(holder)} çıkar; önceki aylar kaynak olarak sanal hesabı korur`,
    },
  },

  entity: {
    rowsBecomeShared: (names) => `${quoteNames(names)} ortak olur`,
    rowsLoseTag: (names) => `${quoteNames(names)} etiketini kaybeder`,
    accountsBecomeHousehold: (names) => `${quoteNames(names)} hane hesabı olur`,
    methodsBecomeHousehold: (names) => `${pick(names.length, 'Ödeme yöntemi', 'Ödeme yöntemleri')} ${quoteNames(names)} hanenin olur`,
    schedulesBecomeShared: (n) => `${n} düzenli kalem ortak olur`,
    archiveHidden: (at) => `${at} ayından itibaren Kişiler ve diğerleri altında gizlenir; satırları ve önceki aylar olduğu gibi kalır`,
  },

  schedule: {
    losesPosted: (months, span) => `${months} aya yazdığı tutar (${span}); ödenmiş olan kalır`,
    note: (posted) => `${posted ? 'Artık bir şey yazılmaz.' : 'Artık bir şey yazılmaz; ödenmiş olan kalır.'} Onun yerine bir aydan itibaren durdurmak için düzenli kalemler listesindeki "… sonunda bitir" seçeneğini kullan.`,
  },
  goalNote: 'İzlediği şeye dokunulmaz.',
  category: {
    losesEstimate: 'tahmini, her ayda',
    rowsKeepPlace: (names) => `${quoteNames(names)} kategorisiz olarak yerinde kalır`,
  },

  restore: {
    restored: (subject, back) => `"${subject}" geri getirildi${back.length ? `: ${back.join('; ')}` : ''}.`,
    noMemo: (name) => `"${name}", uygulama arşivlemenin neyi değiştirdiğini kaydetmeye başlamadan önce arşivlenmişti; bu yüzden yalnızca "${name}" geri geldi.`,
    sourceStays: (source, gone) => `${source == null ? 'Ondan' : `"${source}" içinden`} çıkanlar arşivlemenin taşıdığı yerde kalır: ${gone ? 'o artık yok' : 'o hâlâ arşivde'}.`,
    rowsComeOutAgain: (names, source) => `${quoteNames(names)} yeniden ${outOf(source)} çıkar`,
    restComesOutAgain: (source) => `${outOf(source)} çıkanlar yeniden oradan çıkar`,
    schedulesRun: (names, row) => `${row == null ? 'düzenli' : `"${row}" satırının düzenli`} ${pick(names.length, 'kalemi', 'kalemleri')} ${quoteNames(names)} yeniden işler`,
    followAgain: (names, row) => `${quoteNames(names)} yeniden ${row == null ? 'onu' : `"${row}" satırını`} izler`,
    fillAgain: (names) => `${quoteNames(names)} onu yeniden doldurur`,
    poolsBack: (pools, fills) => `${pick(pools.length, 'sanal hesabı', 'sanal hesapları')} ${quoteNames(pools)} geri geldi${fills.length ? `; yeniden ${quoteNames(fills)} dolduruyor` : ''}`,
    changedSince: (n) => `O zamandan beri değiştirdiğin ${n} şey olduğu gibi kalır.`,
    rowFillsArchivedPool: (row, pool) => `"${row}", arşivlenmiş olan "${pool}" sanal hesabını dolduruyor. Sanal hesabı geri getir: satırı da onunla birlikte geri gelir.`,
    poolHeldInArchivedAccount: (pool, account) => `"${pool}", arşivlenmiş olan "${account}" hesabında tutuluyor. Önce hesabı geri getir.`,
  },
}
