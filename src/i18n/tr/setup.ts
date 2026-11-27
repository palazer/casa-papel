import type { Messages } from '../en'

const capital = (word: string): string => word.charAt(0).toLocaleUpperCase('tr') + word.slice(1)

/** Setting up a household: the form before the first Statement. */
export const setup: Messages['setup'] = {
  form: {
    couldNotSetUp: 'Hane kurulamadı.',
    setUpYourHousehold: 'Haneni kur',
    aFewFactsFirst: 'Önce birkaç bilgi. Hesaplar, gelir ve giderler bir sonraki sayfada, yerlerine oturduklarını gördüğün Bilanço\'da eklenir.',
    backToStart: 'Başa dön',
    householdName: 'Hanenin adı',
    ourHousehold: 'Hanemiz',
    whatTheHouseholdCounts: 'Hanenin hesap yaptığı para birimi. Tek bir hesap ya da satır sonradan başka bir para biriminde olabilir.',
    numberAndDateFormat: 'Sayı ve tarih biçimi',
    firstMonth: 'İlk ay',
    theFirstMonthYou: 'Dolduracağın ilk ay. Para birimi ve ilk ay sonradan değiştirilemez; geri kalan her şey değiştirilebilir.',
    peopleThings: 'Kişiler ve diğerleri',
    whoLivesOnThis: 'Bu parayla kim yaşıyor ve para neye gidiyor. Her biri, Bilanço\'ya kendi adını taşıyan önerilen satırlarını getirir ("Sam – Maaş", "Daire – Kira veya konut kredisi"). Daha fazlası sonradan Hane altında eklenebilir.',
    adults: 'Yetişkinler',
    adultsHelp: (adult) => `${adult} Boş adlar atlanır.`,
    adultName: (i) => `${i + 1}. yetişkinin adı`,
    adult: (i) => `${i + 1}. yetişkin`,
    removeAdult: (i) => `${i + 1}. yetişkini kaldır`,
    addAdult: 'Yetişkin ekle',
    childrenPetsCarsHomes: 'Çocuklar, evcil hayvanlar, arabalar, evler',
    kindOfPersonOr: (i) => `${i + 1}. kişinin ya da şeyin türü`,
    nameOf: (kind) => `Ad (${kind})`,
    eGTheFlat: 'ör. Daire',
    eGTheCar: 'ör. Araba',
    removeThing: (name, kind) => `Kaldır: ${name || kind}`,
    addKind: (kind) => `${capital(kind)} ekle`,
    usedMoreThanOnce: (twice) => `${twice} birden fazla kez kullanılmış. Satırlar ait oldukları kişinin ya da şeyin adını alır; bu yüzden her birine kendi adını ver.`,
    makesAndTheUsual: (adults, thingCount, things) => `Oluşturulacaklar: ${adults}${thingCount ? `, ${things}` : ''} ve olağan gider kategorileri. Şimdilik başka bir şey yok.`,
    openTheStatement: 'Bilanço\'yu aç',
  },
  start: {
    me: 'Ben',
    ourHousehold: 'Hanemiz',
  },
}
