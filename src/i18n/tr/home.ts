import type { Messages } from '../en'

/** The welcome screen, before a household exists on the device. */
export const home: Messages['home'] = {
  welcome: {
    leaveTheDemo: 'Demodan çık',
    lookAtTheDemo: 'Önce demoya bak',
    howItWorks: 'Nasıl çalışır',
    importAFile: 'Dosya içe aktar',
    youAreInThe: 'Demo alanındasın: kendi deposu var, hiç eşitlenmez. Kendi hanene dönmek için istediğin zaman çık.',
    everythingStaysOnThis: 'Giriş yapmadığın sürece her şey bu cihazda kalır; giriş yaparsan bulutta yalnızca parolanın açtığı şifreli bir kopya tutulur.',
    everythingStaysOnThis2: 'Her şey bu cihazda kalır. Casa Papel\'in sunucusu yok.',
    yourHouseholdBudgetAs: 'Hane bütçen; hanenin ne olduğunu bilen, ay ay ilerleyen bir tablo olarak.',
    welcomeToCasaPapel: 'Casa Papel\'e hoş geldin',
    openData: 'Veriler\'i aç',
    unlockTheCloudCopy: 'Bulut kopyasının kilidini aç ya da hangi verinin kalacağına karar ver; ikisi de Veriler altında. Bu cihaz o zamana kadar yeni bir hane başlatmaz.',
    loadTheDemoHousehold: 'Demo haneyi yükle',
    aMadeUpHousehold: 'İki yetişkini, bir çocuğu, bir köpeği ve bir arabası olan uydurma bir hane; içinde gezinebilesin diye. Buradaki hiçbir şey kendi verine dokunmaz.',
    startOnThisDevice: 'Bu cihazda başla',
    setUpYourHousehold: 'Haneni burada kur. Her şey bu tarayıcıda kalır; bulutta şifreli bir kopya tutmak için sonradan Veriler\'den giriş yapabilirsin.',
    setUpYourHousehold2: 'Haneni burada kur. Her şey bu tarayıcıda kalır.',
    useYourHouseholdsEmail: 'Hanenin e-postasını ve parolasını kullan. Hesabında zaten bir hane varsa burada görünür; yoksa bir sonraki adımda kurarsın ve bitirdiğinde yüklenir.',
    someoneInvitedYouPick: 'Biri seni davet etti. Kendi e-postanı ve parolanı seç; hanenin kendi bulut kopyası olur.',
    /** `email` is set apart (bold); `status` says how the sync stands when it is neither idle nor busy, else null. */
    signedInAs: (email, status) => ['Giriş yapan: ', email, `${status ? ` (${status})` : ''}. Bu hane, bitirdiğinde hesabına yüklenir.`],
  },
}
