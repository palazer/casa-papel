import type { Messages } from '../en'

/** The parts every screen shares: the rail, the page header, the legend, the month picker, the charts. */
export const components: Messages['components'] = {
  rail: {
    fold: (label) => `${label} · daralt`,
    screens: 'Ekranlar',
    backToYourOwn: 'Kendi hanene dön',
    demo: 'demo',
    settingsPages: 'Ayar sayfaları',
  },
  infoTip: {
    about: (heading) => `${heading} hakkında`,
  },
  legend: {
    balancesAndNetWorth: 'Bakiyeler ve net varlık',
    goals: 'Hedefler',
    coloursAndMarks: 'Renkler ve işaretler',
    kindsOfMoney: 'Para türleri',
    marks: 'İşaretler',
    anEstimateOnThe: 'Tahmin: sarı zeminde; satırlarından biri tahminken kategori de',
    certainYouKnowThe: 'Kesin: tutarı biliyorsun',
    doneTheMoneyHas: 'Tamam: para hareket etti',
    thisMonthOnlyNothing: 'Yalnızca bu ay: henüz hiçbiri tamam değil, bir kısmı tamam',
    spendingShownAsA: 'Harcama; eksi sayı olarak gösterilir',
    drawnFromSavingsThis: 'Bu ay birikimden çekilen',
    aBalanceBelowZero: 'Sıfırın altında bir bakiye: ekside bir sanal hesap ya da birikim',
    aBalanceYouEntered: 'Kendi girdiğin bir bakiye',
    sampleMonth: 'Eyl',
    aMonthThatIs: 'Geçmiş bir ay: Tablo\'da gri, Bilanço\'da "geçmiş". Yine de değiştirilebilir',
    aFaintBandThe: 'Soluk bir bant: tek bir kategorinin satırları',
    onAScheduleIt: 'Düzenli kalem: kendi aylarına kendiliğinden düşer. Aradaki aylarda satır gridir ve bir sonraki sefer ne zaman, ne kadarla düşeceğini söyler',
    sampleDay: 'ayın 15\'i',
    theDayAnAmount: 'Bir tutarın çıktığı gün, Bilanço\'da: ayın ödemeleri için ona bas',
    notInNetWorth: 'Net varlıkta değil, Bilanço\'da: bir kişinin kendisine ait hesap. Rakamları gridir ve hiçbir toplam onu saymaz',
    linkedOnTheStatement: 'Bağlantılı, Bilanço\'da: bir satır ve doldurduğu, para aldığı ya da ödediği hesap. Öbür uca gitmek için ona bas; soluk ve açıksa o krediyi ya da kartı henüz hiçbir satır ödemiyor',
    moreInTheGuide: 'Kılavuz\'da daha fazlası',
  },
  monthPicker: {
    previousMonth: 'Önceki ay',
    addYear: (year) => `${year + 1} yılını ekle`,
    nextMonth: 'Sonraki ay',
    monthOf: (label) => `${label}: ay`,
    yearOf: (label) => `${label}: yıl`,
  },
  header: {
    redo: 'Yinele',
  },
  charts: {
    now: 'şimdi',
    parts: 'Parçalar',
    noChange: 'değişim yok',
  },
  island: {
    open: 'aç',
    minimize: 'küçült',
  },
}
