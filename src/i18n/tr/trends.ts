import type { Messages } from '../en'

/** Trends: the page of charts. */
export const trends: Messages['trends'] = {
  table: {
    noChange: 'değişim yok',
  },
  tile: {
    nothingBeforeItTo: 'karşılaştırılacak bir öncesi yok',
    noChangeFrom: (since) => `${since} ayına göre değişim yok`,
    upOrDownFrom: (change, changeText, since) => `${since} ayına göre ${changeText} ${change > 0 ? 'artış' : 'azalış'}`,
    fromSince: (since) => `${since} ayına göre`,
    noChange: 'değişim yok',
  },
  page: {
    fromTo: (month, month2) => `${month} – ${month2} arası`,
    partYear: (span) => ` · ${span} ay`,
    other: 'Diğer',
    noChange: 'değişim yok',
    changeFrom: (amount, month) => `${amount}, ${month} ayına göre`,
    now: 'şimdi',
    plan: 'plan',
    trends: 'Grafikler',
    looksAhead: 'İleriye bakış',
    howFarAhead: 'Ne kadar ileriye',
    goals: 'Hedefler',
    goalsOnTheChart: 'Grafikteki hedefler',
    amounts: 'Tutarlar',
    breakdown: 'Döküm',
    shownAs: (label) => `${label}: gösterim`,
    pressATileAbove: 'Grafiğe koymak için yukarıdaki bir kutuya bas.',
    breakdownSummary: (label, stack, span, yearly) => `${label}, parçalarına göre (${stack}); ${span}. Ok tuşları bir ${yearly ? 'yılı' : 'ayı'} okur.`,
    linesSummary: (lines, span, goalCount, targets) => `${lines}; ${span}${goalCount ? `; ${goalCount === 1 ? 'hedef' : 'hedefler'}: ${targets}` : ''}. Ok tuşları bir ayı okur.`,
    changeFromTheYear: 'Önceki yıla göre değişim',
    changeFromTheMonth: 'Önceki aya göre değişim',
    changesSummary: (rows, yearly, span) => `${rows}: bir ${yearly ? 'yıldan' : 'aydan'} diğerine nasıl değiştiği; ${span}. Ok tuşları bir ${yearly ? 'yılı' : 'ayı'} okur.`,
    nothingBeforeItTo: 'karşılaştırılacak bir öncesi yok',
    aYearThatIs: 'yalnızca bir kısmı görünen yıl karşılaştırılmaz',
    amountWhen: (money, isFlow, yearly) => `${money} ${isFlow ? (yearly ? 'yıl içinde' : 'ay içinde') : (yearly ? 'yıl sonunda' : 'ay sonunda')}`,
    figuresAsATable: 'Rakamlar tablo olarak',
    tableCaption: (figureColumns, span, broken, yearly) => `${figureColumns}; ${span}, ${broken && yearly ? 'yıla göre' : 'aya göre'}`,
  },
  goals: {
    itIsInThe: (currency, base) => `Para birimi ${currency}; grafikler ${base} cinsinden olduğu için çizilmez.`,
    byMonth: (month) => ` (en geç ${month})`,
  },
  subjects: {
    debts: 'Borçlar',
    plan: 'Plan',
    n3Years: '3 yıl',
    n5Years: '5 yıl',
    n10Years: '10 yıl',
  },
}
