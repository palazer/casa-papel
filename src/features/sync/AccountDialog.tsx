import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normalizeRecoveryCode } from '@/sync/crypto'
import type { SignInResult } from '@/sync/engine'
import { describeRemoteError } from '@/sync/remote'
import { useSyncEngine } from '@/sync/useSync'
import { txt } from '@/i18n'
import { sentence } from '@/lib/sentence'

const T = txt.sync.account

export type AccountStep = 'signin' | 'bootstrap' | 'join' | 'reset' | 'recovery-code' | 'locked' | 'choose' | 'change-password' | 'new-recovery'

interface Props {
  initial: AccountStep
  inviteCode?: string
  /** This device already holds a household (offered as the thing to keep when locked). */
  hasLocalData: boolean
  onClose: (message?: string) => void
}

const PRIVACY = T.onlyYourPasswordOpens
const PASSWORD_HELP = T.atLeast12Characters

/** Sign in, join with an invite, recover, change the password or rotate the recovery code: one dialog, several steps. */
export function AccountDialog({ initial, inviteCode, hasLocalData, onClose }: Props) {
  const engine = useSyncEngine()
  const [step, setStep] = useState<AccountStep>(initial)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [current, setCurrent] = useState('')
  const [code, setCode] = useState(inviteCode ?? '')
  const [recovery, setRecovery] = useState('')
  const [shownCode, setShownCode] = useState('')
  const [retype, setRetype] = useState('')
  const [afterCode, setAfterCode] = useState<{ step: AccountStep | null; message?: string }>({ step: null })
  const [codeNote, setCodeNote] = useState('')
  const [choice, setChoice] = useState<{ localName: string; cloudName: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!engine) return null

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(describeRemoteError(e))
    } finally {
      setBusy(null)
    }
  }

  function showCode(c: string, next: { step: AccountStep | null; message?: string }, note = '') {
    setShownCode(c)
    setRetype('')
    setCodeNote(note)
    setAfterCode(next)
    setStep('recovery-code')
  }

  function handleResult(res: SignInResult, okMessage: string) {
    if (res.kind === 'ok') onClose(okMessage)
    else if (res.kind === 'created') showCode(res.recoveryCode, { step: null, message: T.yourHouseholdNowHas })
    else if (res.kind === 'locked') setStep('locked')
    else {
      setChoice(engine!.getView().choice)
      setStep('choose')
    }
  }

  const passwordsMatch = password.length > 0 && password === password2
  /** Locked after a reload: the key derived at sign-in is gone, so the password is asked once more. */
  const needsPassword = step === 'locked' && engine.needsPasswordToUnlock()

  const signIn = () => run(T.workingOutYourKeys, async () => {
    handleResult(await engine.signIn(email, password), T.signedInThisDevice)
  })

  const bootstrap = () => run(T.settingTheHouseholdPassword, async () => {
    if (!passwordsMatch) throw new Error(T.theTwoPasswordsAre)
    const { recoveryCode } = await engine.bootstrap(email, current, password)
    showCode(recoveryCode, { step: null, message: T.theHouseholdPasswordIs })
  })

  const join = () => run(T.creatingYourAccount, async () => {
    if (!passwordsMatch) throw new Error(T.theTwoPasswordsAre)
    const { recoveryCode } = await engine.join(code.trim(), email, password)
    showCode(recoveryCode, { step: null, message: T.welcomeYourHouseholdNow })
  })

  const reset = () => run(T.checkingTheRecoveryCode, async () => {
    if (!passwordsMatch) throw new Error(T.theTwoPasswordsAre)
    const res = await engine.resetWithRecovery(email, recovery, password)
    if (res.kind === 'locked') return setStep('locked')
    const fresh = await engine.newRecoveryCode()
    showCode(fresh, res.kind === 'choose' ? { step: 'choose' } : { step: null, message: T.passwordSetThisDevice }, T.theCodeYouJust)
    if (res.kind === 'choose') setChoice(engine.getView().choice)
  })

  const unlock = () => run(T.unlocking, async () => {
    await engine.unlockWithRecovery(recovery, password || undefined)
    onClose(T.unlockedTheCloudCopy)
  })

  const replaceCloud = () => run(T.uploadingThisDevicesData, async () => {
    const fresh = await engine.replaceCloudWithLocal(password || undefined)
    showCode(fresh, { step: null, message: T.theCloudCopyWas }, T.theOldRecoveryCode)
  })

  const decide = (c: 'keep-local' | 'take-cloud') => run(T.applying, async () => {
    await engine.finishFirstSync(c)
    onClose(c === 'keep-local' ? T.theCloudCopyNow : T.thisDeviceNowHolds)
  })

  const changePassword = () => run(T.workingOutYourKeys, async () => {
    if (!passwordsMatch) throw new Error(T.theTwoPasswordsAre)
    await engine.changePassword(current, password)
    onClose(T.passwordChangedDevicesAlready)
  })

  const rotate = () => run(T.makingANewCode, async () => {
    showCode(await engine.newRecoveryCode(), { step: null, message: T.newRecoveryCodeSaved })
  })

  const finishCode = () => {
    if (afterCode.step) {
      setStep(afterCode.step)
    } else onClose(afterCode.message)
  }

  const title: Record<AccountStep, string> = {
    signin: txt.common.signIn,
    bootstrap: T.firstSignInWith,
    join: T.joinWithAnInvite,
    reset: T.forgotThePassword,
    'recovery-code': T.yourRecoveryCode,
    locked: T.thisDeviceIsLocked,
    choose: T.whichDataDoYou,
    'change-password': T.changeTheHouseholdPassword,
    'new-recovery': T.newRecoveryCode,
  }

  const codeOk = shownCode !== '' && normalizeRecoveryCode(retype) === normalizeRecoveryCode(shownCode)

  return (
    <Dialog open onOpenChange={(o) => { if (!o && step !== 'recovery-code') onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title[step]}</DialogTitle>
          {step === 'signin' && <DialogDescription>{T.useTheHouseholdsEmail}</DialogDescription>}
          {step === 'join' && <DialogDescription>{T.pickTheEmailAnd(PRIVACY)}</DialogDescription>}
          {step === 'bootstrap' && <DialogDescription>{T.forTheVeryFirst(PRIVACY)}</DialogDescription>}
          {step === 'reset' && <DialogDescription>{T.yourRecoveryCodeProves}</DialogDescription>}
          {step === 'locked' && <DialogDescription>{T.theAccountsPasswordIs}</DialogDescription>}
          {step === 'change-password' && <DialogDescription>{T.devicesThatAreAlready}</DialogDescription>}
          {step === 'new-recovery' && <DialogDescription>{T.makesAFreshCode}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-3">
          {step === 'join' && (
            <Field id="acc-code" label={T.inviteCode} value={code} onChange={setCode} help={T.fromTheLinkYou} />
          )}
          {(step === 'signin' || step === 'bootstrap' || step === 'join' || step === 'reset') && (
            <Field id="acc-email" label={T.email} type="email" value={email} onChange={setEmail} autoFocus={step !== 'join' || !!inviteCode} help={step === 'join' ? T.theHouseholdsSignIn : undefined} />
          )}
          {step === 'bootstrap' && (
            <Field id="acc-temporary" label={T.temporaryPassword} type="password" value={current} onChange={setCurrent} help={T.theOneTypedInto} />
          )}
          {step === 'reset' && (
            <Field id="acc-recovery" label={T.recoveryCode} value={recovery} onChange={setRecovery} help={T.the26CharacterCode} />
          )}
          {step === 'change-password' && (
            <Field id="acc-current" label={T.currentPassword} type="password" value={current} onChange={setCurrent} autoFocus />
          )}
          {step === 'locked' && (
            <Field id="acc-recovery" label={T.recoveryCode} value={recovery} onChange={setRecovery} autoFocus help={T.unlocksTheCloudCopy} />
          )}
          {needsPassword && (
            <Field id="acc-password-locked" label={T.password} type="password" value={password} onChange={setPassword} help={T.yourSignInPassword} />
          )}
          {(step === 'signin' || step === 'bootstrap' || step === 'join' || step === 'reset' || step === 'change-password') && (
            <Field
              id="acc-password" label={step === 'signin' ? T.password : T.newPassword} type="password" value={password} onChange={setPassword}
              onEnter={step === 'signin' ? signIn : undefined}
              help={step === 'signin' ? undefined : PASSWORD_HELP}
            />
          )}
          {(step === 'join' || step === 'bootstrap' || step === 'reset' || step === 'change-password') && (
            <Field id="acc-password2" label={T.newPasswordAgain} type="password" value={password2} onChange={setPassword2} />
          )}

          {step === 'recovery-code' && (
            <div className="space-y-3">
              <p className="text-sm">{T.thisCodeIsThe}</p>
              {codeNote && <p className="text-sm">{codeNote}</p>}
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3">
                <code className="text-base tracking-wider" data-testid="recovery-code">{shownCode}</code>
                <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(shownCode)}>{T.copy}</Button>
              </div>
              <Field id="acc-retype" label={T.typeTheCodeBack} value={retype} onChange={setRetype} autoFocus help={T.proofToYourselfThat} />
            </div>
          )}

          {step === 'choose' && choice && (
            <div className="space-y-2 text-sm">
              <p>{sentence(T.twoHouseholds(<strong>{choice.localName}</strong>, <strong>{choice.cloudName}</strong>))}</p>
              <p className="text-muted-foreground">{T.exportFirstFromThe}</p>
            </div>
          )}

          {step === 'locked' && hasLocalData && (
            <p className="text-xs text-muted-foreground">{T.noRecoveryCodeYou}</p>
          )}

          {busy && <p className="text-sm text-muted-foreground" role="status">{busy}</p>}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>

        <DialogFooter className="min-w-0 flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap gap-x-1 gap-y-0">
            {step === 'signin' && <Button variant="ghost" size="sm" onClick={() => { setError(null); setStep('reset') }} disabled={!!busy}>{T.forgotThePassword2}</Button>}
            {step === 'signin' && <Button variant="ghost" size="sm" onClick={() => { setError(null); setStep('join') }} disabled={!!busy}>{txt.common.haveInvite}</Button>}
            {step === 'signin' && <Button variant="ghost" size="sm" onClick={() => { setError(null); setStep('bootstrap') }} disabled={!!busy}>{T.firstTimeTemporaryPassword}</Button>}
            {step === 'locked' && hasLocalData && <Button variant="outline" size="sm" className="h-auto whitespace-normal py-1.5 text-left" onClick={replaceCloud} disabled={!!busy || (needsPassword && !password)}>{T.replaceTheCloudCopy}</Button>}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {step !== 'recovery-code' && <Button variant="outline" onClick={() => onClose()} disabled={!!busy}>{txt.common.cancel}</Button>}
            {step === 'signin' && <Button onClick={signIn} disabled={!!busy || !email || !password}>{txt.common.signIn}</Button>}
            {step === 'join' && <Button onClick={join} disabled={!!busy || !code || !email || !passwordsMatch}>{T.createAccount}</Button>}
            {step === 'bootstrap' && <Button onClick={bootstrap} disabled={!!busy || !email || !current || !passwordsMatch}>{T.setHouseholdPassword}</Button>}
            {step === 'reset' && <Button onClick={reset} disabled={!!busy || !email || !recovery || !passwordsMatch}>{T.setNewPassword}</Button>}
            {step === 'locked' && <Button onClick={unlock} disabled={!!busy || !recovery || (needsPassword && !password)}>{T.unlock}</Button>}
            {step === 'change-password' && <Button onClick={changePassword} disabled={!!busy || !current || !passwordsMatch}>{T.changePassword}</Button>}
            {step === 'new-recovery' && <Button onClick={rotate} disabled={!!busy}>{T.makeANewCode}</Button>}
            {step === 'recovery-code' && <Button onClick={finishCode} disabled={!codeOk}>{T.iHaveStoredIt}</Button>}
            {step === 'choose' && (
              <>
                <Button variant="outline" onClick={() => decide('take-cloud')} disabled={!!busy}>{T.takeTheCloudCopy}</Button>
                <Button onClick={() => decide('keep-local')} disabled={!!busy}>{T.keepThisDevicesData}</Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ id, label, value, onChange, type = 'text', help, autoFocus, onEnter }: {
  id: string; label: string; value: string; onChange: (v: string) => void; type?: string; help?: string; autoFocus?: boolean; onEnter?: () => void
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} autoFocus={autoFocus} autoComplete={type === 'password' ? 'current-password' : type === 'email' ? 'email' : 'off'} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter() }} />
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  )
}
