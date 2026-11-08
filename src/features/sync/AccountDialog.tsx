import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normalizeRecoveryCode } from '@/sync/crypto'
import type { SignInResult } from '@/sync/engine'
import { describeRemoteError } from '@/sync/remote'
import { useSyncEngine } from '@/sync/useSync'

export type AccountStep = 'signin' | 'join' | 'reset' | 'recovery-code' | 'locked' | 'choose' | 'change-password' | 'new-recovery'

interface Props {
  initial: AccountStep
  inviteCode?: string
  /** This device already holds a household (offered as the thing to keep when locked). */
  hasLocalData: boolean
  onClose: (message?: string) => void
}

const PRIVACY = 'Only your password opens the cloud copy. Nobody else can read it, not even the person who runs this app. The password itself never leaves this device.'
const PASSWORD_HELP = 'At least 12 characters. A few words you will remember work well. Everyone in the household who signs in uses the same email and password.'

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
    else if (res.kind === 'created') showCode(res.recoveryCode, { step: null, message: 'Your household now has a cloud copy. Other devices can sign in with the same email and password.' })
    else if (res.kind === 'locked') setStep('locked')
    else {
      setChoice(engine!.getView().choice)
      setStep('choose')
    }
  }

  const passwordsMatch = password.length > 0 && password === password2

  const signIn = () => run('Working out your keys…', async () => {
    handleResult(await engine.signIn(email, password), 'Signed in. This device now syncs with your household.')
  })

  const join = () => run('Creating your account…', async () => {
    if (!passwordsMatch) throw new Error('The two passwords are not the same.')
    const { recoveryCode } = await engine.join(code.trim(), email, password)
    showCode(recoveryCode, { step: null, message: 'Welcome. Your household now has a cloud copy; sign in on another device with the same email and password.' })
  })

  const reset = () => run('Checking the recovery code…', async () => {
    if (!passwordsMatch) throw new Error('The two passwords are not the same.')
    const res = await engine.resetWithRecovery(email, recovery, password)
    if (res.kind === 'locked') return setStep('locked')
    const fresh = await engine.newRecoveryCode()
    showCode(fresh, res.kind === 'choose' ? { step: 'choose' } : { step: null, message: 'Password set. This device syncs again.' }, 'The code you just used has been replaced. Store this new one.')
    if (res.kind === 'choose') setChoice(engine.getView().choice)
  })

  const unlock = () => run('Unlocking…', async () => {
    await engine.unlockWithRecovery(recovery)
    onClose('Unlocked. The cloud copy now opens with the password you typed.')
  })

  const replaceCloud = () => run('Uploading this device\'s data…', async () => {
    const fresh = await engine.replaceCloudWithLocal()
    showCode(fresh, { step: null, message: 'The cloud copy was replaced with this device\'s data.' }, 'The old recovery code is no longer valid.')
  })

  const decide = (c: 'keep-local' | 'take-cloud') => run('Applying…', async () => {
    await engine.finishFirstSync(c)
    onClose(c === 'keep-local' ? 'The cloud copy now holds this device\'s data.' : 'This device now holds the cloud copy.')
  })

  const changePassword = () => run('Working out your keys…', async () => {
    if (!passwordsMatch) throw new Error('The two passwords are not the same.')
    await engine.changePassword(current, password)
    onClose('Password changed. Devices already signed in keep working; new ones sign in with the new password.')
  })

  const rotate = () => run('Making a new code…', async () => {
    showCode(await engine.newRecoveryCode(), { step: null, message: 'New recovery code saved. The old one no longer works.' })
  })

  const finishCode = () => {
    if (afterCode.step) {
      setStep(afterCode.step)
    } else onClose(afterCode.message)
  }

  const title: Record<AccountStep, string> = {
    signin: 'Sign in',
    join: 'Join with an invite',
    reset: 'Forgot the password',
    'recovery-code': 'Your recovery code',
    locked: 'This device is locked out',
    choose: 'Which data do you want to keep?',
    'change-password': 'Change the household password',
    'new-recovery': 'New recovery code',
  }

  const codeOk = shownCode !== '' && normalizeRecoveryCode(retype) === normalizeRecoveryCode(shownCode)

  return (
    <Dialog open onOpenChange={(o) => { if (!o && step !== 'recovery-code') onClose() }}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title[step]}</DialogTitle>
          {step === 'signin' && <DialogDescription>Use the household's email and password. Signing in keeps an encrypted copy of this household in the cloud and syncs it to every device that signs in.</DialogDescription>}
          {step === 'join' && <DialogDescription>Pick the email and password your household will sign in with. {PRIVACY}</DialogDescription>}
          {step === 'reset' && <DialogDescription>Your recovery code proves it is you and unlocks the data under a new password.</DialogDescription>}
          {step === 'locked' && <DialogDescription>The password you typed is right for the account, but the cloud copy was locked with a different one, probably after a reset on another device.</DialogDescription>}
          {step === 'change-password' && <DialogDescription>Devices that are already signed in keep working. New devices sign in with the new password.</DialogDescription>}
          {step === 'new-recovery' && <DialogDescription>Makes a fresh code and invalidates the old one. Do this if the old code may have been seen by someone else.</DialogDescription>}
        </DialogHeader>

        <div className="space-y-3">
          {step === 'join' && (
            <Field id="acc-code" label="Invite code" value={code} onChange={setCode} help="From the link you were sent. A code works once and for seven days." />
          )}
          {(step === 'signin' || step === 'join' || step === 'reset') && (
            <Field id="acc-email" label="Email" type="email" value={email} onChange={setEmail} autoFocus={step !== 'join' || !!inviteCode} help={step === 'join' ? 'The household\'s sign-in name. It cannot be changed later.' : undefined} />
          )}
          {step === 'reset' && (
            <Field id="acc-recovery" label="Recovery code" value={recovery} onChange={setRecovery} help="The 26-character code shown when the household was set up. Dashes and case do not matter." />
          )}
          {step === 'change-password' && (
            <Field id="acc-current" label="Current password" type="password" value={current} onChange={setCurrent} autoFocus />
          )}
          {step === 'locked' && (
            <Field id="acc-recovery" label="Recovery code" value={recovery} onChange={setRecovery} autoFocus help="Unlocks the cloud copy and re-locks it with the password you just typed." />
          )}
          {(step === 'signin' || step === 'join' || step === 'reset' || step === 'change-password') && (
            <Field
              id="acc-password" label={step === 'signin' ? 'Password' : 'New password'} type="password" value={password} onChange={setPassword}
              onEnter={step === 'signin' ? signIn : undefined}
              help={step === 'signin' ? undefined : PASSWORD_HELP}
            />
          )}
          {(step === 'join' || step === 'reset' || step === 'change-password') && (
            <Field id="acc-password2" label="New password again" type="password" value={password2} onChange={setPassword2} />
          )}

          {step === 'recovery-code' && (
            <div className="space-y-3">
              <p className="text-sm">This code is the only way back into the cloud copy if you forget the password. Keep it with your passwords, or print it. It is shown once.</p>
              {codeNote && <p className="text-sm">{codeNote}</p>}
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3">
                <code className="text-base tracking-wider" data-testid="recovery-code">{shownCode}</code>
                <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(shownCode)}>Copy</Button>
              </div>
              <Field id="acc-retype" label="Type the code back to continue" value={retype} onChange={setRetype} autoFocus help="Proof to yourself that it is stored somewhere." />
            </div>
          )}

          {step === 'choose' && choice && (
            <div className="space-y-2 text-sm">
              <p>This device holds <strong>{choice.localName}</strong>; the cloud copy holds <strong>{choice.cloudName}</strong>. They are different households, so one has to go.</p>
              <p className="text-muted-foreground">Export first from the Data screen if you want to keep a file of what you replace.</p>
            </div>
          )}

          {step === 'locked' && hasLocalData && (
            <p className="text-xs text-muted-foreground">No recovery code? You can also start over: replace the cloud copy with this device's data under a fresh key.</p>
          )}

          {busy && <p className="text-sm text-muted-foreground" role="status">{busy}</p>}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>

        <DialogFooter className="flex-row flex-wrap gap-2 sm:justify-between">
          <div className="flex gap-2">
            {step === 'signin' && <Button variant="ghost" onClick={() => { setError(null); setStep('reset') }} disabled={!!busy}>Forgot the password?</Button>}
            {step === 'signin' && <Button variant="ghost" onClick={() => { setError(null); setStep('join') }} disabled={!!busy}>I have an invite</Button>}
            {step === 'locked' && hasLocalData && <Button variant="outline" onClick={replaceCloud} disabled={!!busy}>Replace the cloud copy with this device's data</Button>}
          </div>
          <div className="flex gap-2">
            {step !== 'recovery-code' && <Button variant="outline" onClick={() => onClose()} disabled={!!busy}>Cancel</Button>}
            {step === 'signin' && <Button onClick={signIn} disabled={!!busy || !email || !password}>Sign in</Button>}
            {step === 'join' && <Button onClick={join} disabled={!!busy || !code || !email || !passwordsMatch}>Create account</Button>}
            {step === 'reset' && <Button onClick={reset} disabled={!!busy || !email || !recovery || !passwordsMatch}>Set new password</Button>}
            {step === 'locked' && <Button onClick={unlock} disabled={!!busy || !recovery}>Unlock</Button>}
            {step === 'change-password' && <Button onClick={changePassword} disabled={!!busy || !current || !passwordsMatch}>Change password</Button>}
            {step === 'new-recovery' && <Button onClick={rotate} disabled={!!busy}>Make a new code</Button>}
            {step === 'recovery-code' && <Button onClick={finishCode} disabled={!codeOk}>I have stored it</Button>}
            {step === 'choose' && (
              <>
                <Button variant="outline" onClick={() => decide('take-cloud')} disabled={!!busy}>Take the cloud copy</Button>
                <Button onClick={() => decide('keep-local')} disabled={!!busy}>Keep this device's data</Button>
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
