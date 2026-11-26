/** The welcome screen, before a household exists on the device. */
export const home = {
  welcome: {
    leaveTheDemo: 'Leave the demo',
    lookAtTheDemo: 'Look at the demo first',
    howItWorks: 'How it works',
    importAFile: 'Import a file',
    youAreInThe: 'You are in the demo sandbox: its own store, never synced. Leave it any time to get back to your own household.',
    everythingStaysOnThis: 'Everything stays on this device unless you sign in, which keeps an encrypted copy in the cloud that only your password opens.',
    everythingStaysOnThis2: 'Everything stays on this device. Casa Papel has no server.',
    yourHouseholdBudgetAs: 'Your household budget as a month-by-month grid that knows what a household is.',
    welcomeToCasaPapel: 'Welcome to Casa Papel',
    openData: 'Open Data',
    unlockTheCloudCopy: 'Unlock the cloud copy, or decide which data to keep, under Data. This device starts no new household until then.',
    loadTheDemoHousehold: 'Load the demo household',
    aMadeUpHousehold: 'A made-up household with two adults, a child, a dog and a car, so you can click around. Nothing here touches your own data.',
    startOnThisDevice: 'Start on this device',
    setUpYourHousehold: 'Set up your household here. Everything stays in this browser; you can sign in later from Data to keep an encrypted copy in the cloud.',
    setUpYourHousehold2: 'Set up your household here. Everything stays in this browser.',
    useYourHouseholdsEmail: 'Use your household\'s email and password. A household already in your account appears here; otherwise you set one up next and it is uploaded when you finish.',
    someoneInvitedYouPick: 'Someone invited you. Pick your own email and password; your household gets its own cloud copy.',
    /** `email` is set apart (bold); `status` says how the sync stands when it is neither idle nor busy, else null. */
    signedInAs: <N>(email: N, status: string | null): Array<string | N> => ['Signed in as ', email, `${status ? ` (${status})` : ''}. This household is uploaded to your account when you finish.`],
  },
}
