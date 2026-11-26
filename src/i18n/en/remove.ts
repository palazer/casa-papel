/** "Archive or delete…": the dialog that says what either would do. */
export const remove = {
  dialog: {
    nothingToRemove: 'Nothing to remove',
    archiveItOrDelete: 'Archive it or delete it. You can undo this right after.',
    youCanUndoThis: 'You can undo this right after.',
    archiveFrom: 'Archive from',
    earlierMonthsStayExactly: 'Earlier months stay exactly as they are. Restore any time under Household: restoring puts back what is listed here.',
    deletingRemoves: 'Deleting removes',
    onlyTheItself: (kindWord: string) => `Only the ${kindWord} itself`,
    alsoChanges: 'Also changes',
    resolveTheseFirst: 'Resolve these first',
    archiveFromMonth: (month: string) => `Archive from ${month}`,
  },
}
