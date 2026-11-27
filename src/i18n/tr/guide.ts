import type { Messages } from '../en'
import { guide as english } from '../en/guide'

/**
 * The Guide. Its screen's own controls are Turkish; the lead and the topics stay English until they are translated
 * (step 3 of the language plan), and the screen marks them as English text until then.
 */
export const guide: Messages['guide'] = {
  lead: english.lead,
  topics: english.topics,
  screen: {
    theChoices: 'Seçenekler',
    relatedTips: 'İlgili ipuçları',
    open: (label) => `Aç: ${label}`,
    topics: 'Konular',
    nothingMatchesTryAnother: (shown) => `"${shown}" ile eşleşen bir şey yok. Başka bir kelime dene.`,
    topicsMatch: (count, shown) => `${count} konu "${shown}" ile eşleşiyor`,
    guide: 'Kılavuz',
    howCasaPapelWorks: 'Casa Papel nasıl çalışır; konu konu',
    searchTheGuide: 'Kılavuzda ara',
    tryTheDemo: 'Demoyu dene',
    openOnGithub: 'GitHub\'da aç',
    results: 'Sonuçlar',
  },
}
