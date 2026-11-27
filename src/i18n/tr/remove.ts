import type { Messages } from '../en'

/** "Archive or delete…": the dialog that says what either would do. */
export const remove: Messages['remove'] = {
  dialog: {
    nothingToRemove: 'Kaldırılacak bir şey yok',
    archiveItOrDelete: 'Arşivle ya da sil. Hemen ardından geri alabilirsin.',
    youCanUndoThis: 'Hemen ardından geri alabilirsin.',
    archiveFrom: 'Şu aydan itibaren arşivle',
    earlierMonthsStayExactly: 'Önceki aylar tam olduğu gibi kalır. İstediğin zaman Hane altından geri getir: geri getirmek burada listelenenleri yerine koyar.',
    deletingRemoves: 'Silmek şunları kaldırır',
    onlyTheItself: (kindWord) => `Yalnızca ${kindWord}, başka hiçbir şey`,
    alsoChanges: 'Şunlar da değişir',
    resolveTheseFirst: 'Önce bunları çöz',
    archiveFromMonth: (month) => `Arşivle: ${month} ve sonrası`,
  },
}
