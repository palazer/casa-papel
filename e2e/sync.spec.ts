import { expect, test, type Browser, type Page } from '@playwright/test'
import { FakeSupabase } from './fakeSupabase'

const PW = 'correct horse battery staple'

async function device(browser: Browser, server: FakeSupabase): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await context.newPage()
  await server.install(page)
  return page
}

async function storeRecoveryCode(page: Page): Promise<string> {
  const dlg = page.getByRole('dialog')
  const code = (await dlg.getByTestId('recovery-code').innerText()).trim()
  expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}$/)
  await dlg.getByLabel('Type the code back to continue').fill(code.toLowerCase())
  await dlg.getByRole('button', { name: 'I have stored it' }).click()
  await expect(dlg).toBeHidden()
  return code
}

test.describe('cloud sync', () => {
  test('first device creates the household and invites; a second device pulls; edits flow; recovery resets the password', async ({ browser }) => {
    test.setTimeout(120_000)
    const server = new FakeSupabase()
    const owner = server.addUser('erkin@example.test')
    server.admins.add(owner.id)

    // ----- device A: sign in from the home screen, load the demo as its data, invite someone -----
    const a = await device(browser, server)
    await a.goto('./')
    await a.getByRole('button', { name: 'Sign in' }).click()
    const dlgA = a.getByRole('dialog')
    await dlgA.getByLabel('Email').fill('Erkin@Example.test')
    await dlgA.getByLabel('Password', { exact: true }).fill(PW)
    await dlgA.getByRole('button', { name: 'Sign in' }).click()
    await expect(dlgA.getByRole('heading', { name: 'Your recovery code' })).toBeVisible({ timeout: 20_000 })
    const recoveryCode = await storeRecoveryCode(a)
    expect(server.members).toHaveLength(1)

    await a.getByRole('button', { name: 'Load the demo household' }).click()
    await expect(a.getByRole('button', { name: /^Rent Nov 2026/ })).toBeVisible()
    await expect(a.getByRole('button', { name: /^Sync: Synced/ })).toBeVisible({ timeout: 15_000 })
    expect(server.snapshots.size).toBe(1)

    await a.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Data' }).click()
    await expect(a.getByTestId('sync-status')).toHaveText(/Synced/)
    await a.getByRole('button', { name: 'Invite someone' }).first().click()
    const link = await a.getByTestId('invite-link').innerText()
    expect(link).toMatch(/\?invite=[0-9A-HJKMNP-TV-Z]{20}$/)
    await a.screenshot({ path: 'e2e/output/sync-data.png', fullPage: true })

    // ----- device B: same household, second device -----
    const b = await device(browser, server)
    await b.goto('./')
    await b.getByRole('button', { name: 'Sign in' }).click()
    const dlgB = b.getByRole('dialog')
    await dlgB.getByLabel('Email').fill('erkin@example.test')
    await dlgB.getByLabel('Password', { exact: true }).fill(PW)
    await dlgB.getByRole('button', { name: 'Sign in' }).click()
    await expect(dlgB).toBeHidden({ timeout: 20_000 })
    const utilB = b.getByRole('button', { name: /^Utilities Nov 2026/ })
    await expect(utilB).toContainText('210', { timeout: 15_000 })

    // B edits, A syncs and sees it
    await utilB.click()
    await b.getByLabel('Amount in EUR').fill('333')
    await b.getByRole('button', { name: 'Save' }).click()
    await expect(b.getByRole('dialog')).toBeHidden()
    await expect(b.getByRole('button', { name: /^Sync: Synced/ })).toBeVisible({ timeout: 15_000 })
    await a.getByRole('button', { name: 'Sync now' }).click()
    await a.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Grid' }).click()
    await expect(a.getByRole('button', { name: /^Utilities Nov 2026/ })).toContainText('333', { timeout: 15_000 })

    // ----- device C: forgot the password, recovers with the code -----
    const c = await device(browser, server)
    await c.goto('./')
    await c.getByRole('button', { name: 'Sign in' }).click()
    const dlgC = c.getByRole('dialog')
    await dlgC.getByRole('button', { name: 'Forgot the password?' }).click()
    await dlgC.getByLabel('Email').fill('erkin@example.test')
    await dlgC.getByLabel('Recovery code').fill(recoveryCode)
    await dlgC.getByLabel('New password', { exact: true }).fill('a completely new password')
    await dlgC.getByLabel('New password again').fill('a completely new password')
    await dlgC.getByRole('button', { name: 'Set new password' }).click()
    await expect(dlgC.getByRole('heading', { name: 'Your recovery code' })).toBeVisible({ timeout: 30_000 })
    const newCode = await storeRecoveryCode(c)
    expect(newCode).not.toBe(recoveryCode)
    await expect(c.getByRole('button', { name: /^Utilities Nov 2026/ })).toContainText('333', { timeout: 15_000 })

    // the old password is gone; the new one works on a fresh device, and A keeps working unchanged
    const d = await device(browser, server)
    await d.goto('./')
    await d.getByRole('button', { name: 'Sign in' }).click()
    const dlgD = d.getByRole('dialog')
    await dlgD.getByLabel('Email').fill('erkin@example.test')
    await dlgD.getByLabel('Password', { exact: true }).fill(PW)
    await dlgD.getByRole('button', { name: 'Sign in' }).click()
    await expect(dlgD.getByRole('alert')).toHaveText(/Email or password is wrong/, { timeout: 20_000 })
    await dlgD.getByLabel('Password', { exact: true }).fill('a completely new password')
    await dlgD.getByRole('button', { name: 'Sign in' }).click()
    await expect(dlgD).toBeHidden({ timeout: 20_000 })
    await expect(d.getByRole('button', { name: /^Rent Nov 2026/ })).toBeVisible({ timeout: 15_000 })

    // ----- the invite link creates a separate account -----
    const e = await device(browser, server)
    await e.goto(link)
    const dlgE = e.getByRole('dialog')
    await expect(dlgE.getByRole('heading', { name: 'Join with an invite' })).toBeVisible()
    await expect(dlgE.getByLabel('Invite code')).toHaveValue(/^[0-9A-HJKMNP-TV-Z]{20}$/)
    await dlgE.getByLabel('Email').fill('brother@example.test')
    await dlgE.getByLabel('New password', { exact: true }).fill('short')
    await dlgE.getByLabel('New password again').fill('short')
    await dlgE.getByRole('button', { name: 'Create account' }).click()
    await expect(dlgE.getByRole('alert')).toHaveText(/at least 12 characters/i)
    await dlgE.getByLabel('New password', { exact: true }).fill('brothers own long password')
    await dlgE.getByLabel('New password again').fill('brothers own long password')
    await dlgE.getByRole('button', { name: 'Create account' }).click()
    await expect(dlgE.getByRole('heading', { name: 'Your recovery code' })).toBeVisible({ timeout: 30_000 })
    await storeRecoveryCode(e)
    expect(server.users.map((u) => u.email)).toContain('brother@example.test')
    expect(server.members).toHaveLength(2)
    // used once: the same link is refused
    const f = await device(browser, server)
    await f.goto(link)
    const dlgF = f.getByRole('dialog')
    await dlgF.getByLabel('Email').fill('someone@example.test')
    await dlgF.getByLabel('New password', { exact: true }).fill('another long password here')
    await dlgF.getByLabel('New password again').fill('another long password here')
    await dlgF.getByRole('button', { name: 'Create account' }).click()
    await expect(dlgF.getByRole('alert')).toHaveText(/not valid any more/, { timeout: 20_000 })

    // ----- sign out keeps the data; the demo sandbox has no sync -----
    await a.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Data' }).click()
    await a.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(a.getByText('Signed out. Your data stays on this device.')).toBeVisible()
    await expect(a.getByRole('button', { name: /^Sync:/ })).toHaveCount(0)
    await a.goto('?demo=1')
    await a.getByRole('button', { name: 'Load the demo household' }).click()
    await a.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Data' }).click()
    await expect(a.getByText('Sync is off in the demo sandbox.')).toBeVisible()
  })
})
