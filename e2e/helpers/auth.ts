import { type APIRequestContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

type DevLoginOptions = {
  email: string
  password?: string
}

type DevRole = 'host' | 'player'

const DEFAULT_PASSWORD = 'Pickle123!'
const LOGIN_WAIT_TIMEOUT = 15_000
const REDIRECT_WAIT_TIMEOUT = 25_000
const MAX_SUBMIT_ATTEMPTS = 3

const SELECTORS: Record<DevRole, { route: string; email: string; password: string; submit: string }> = {
  host: {
    route: '/host/login',
    email: 'dev-host-email-input',
    password: 'dev-host-password-input',
    submit: 'dev-host-login-submit',
  },
  player: {
    route: '/login',
    email: 'dev-player-email-input',
    password: 'dev-player-password-input',
    submit: 'dev-player-login-submit',
  },
}

async function devLoginByRole(page: Page, role: DevRole, options: DevLoginOptions) {
  const password = options.password ?? process.env.E2E_DUMMY_PASSWORD ?? DEFAULT_PASSWORD
  const selectors = SELECTORS[role]

  await page.goto(selectors.route)

  const emailInput = page.getByTestId(selectors.email)
  const passwordInput = page.getByTestId(selectors.password)
  const submit = page.getByTestId(selectors.submit)

  await emailInput.waitFor({ state: 'visible', timeout: LOGIN_WAIT_TIMEOUT })
  await emailInput.fill(options.email)
  await passwordInput.fill(password)
  await submit.waitFor({ state: 'visible', timeout: LOGIN_WAIT_TIMEOUT })

  for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt += 1) {
    await submit.scrollIntoViewIfNeeded()
    await submit.click({ force: true, timeout: 5_000 })
    try {
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: REDIRECT_WAIT_TIMEOUT })
      return
    } catch {
      if (attempt === MAX_SUBMIT_ATTEMPTS) {
        throw new Error(`Dev ${role} login did not leave /login after ${MAX_SUBMIT_ATTEMPTS} attempts`)
      }
    }
  }
}

export async function devLogin(page: Page, options: DevLoginOptions) {
  await devLoginByRole(page, 'host', options)
}

export async function devPlayerLogin(page: Page, options: DevLoginOptions) {
  await devLoginByRole(page, 'player', options)
}

type ApiLoginOptions = {
  email: string
  password?: string
  origin: string
}

function getSupabaseConfig() {
  const envFile = path.resolve(process.cwd(), '.env')
  const envMap: Record<string, string> = {}
  if (fs.existsSync(envFile)) {
    const raw = fs.readFileSync(envFile, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx <= 0) continue
      const key = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim().replace(/^"(.*)"$/, '$1')
      envMap[key] = value
    }
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? envMap.EXPO_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? envMap.EXPO_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY for E2E auth setup')
  }

  return { supabaseUrl, supabaseAnonKey }
}

function getSupabaseStorageKey(supabaseUrl: string) {
  const hostname = new URL(supabaseUrl).hostname
  const projectRef = hostname.split('.')[0]
  return `sb-${projectRef}-auth-token`
}

export async function buildHostAuthStorageState(request: APIRequestContext, options: ApiLoginOptions) {
  const { supabaseUrl, supabaseAnonKey } = getSupabaseConfig()
  const password = options.password ?? process.env.E2E_DUMMY_PASSWORD ?? DEFAULT_PASSWORD

  const response = await request.post(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    headers: {
      apikey: supabaseAnonKey,
      'Content-Type': 'application/json',
    },
    data: {
      email: options.email,
      password,
    },
  })

  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`Supabase password login failed (${response.status()}): ${body}`)
  }

  const data = await response.json()
  const now = Math.floor(Date.now() / 1000)
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type,
    expires_in: data.expires_in,
    expires_at: data.expires_at ?? now + Number(data.expires_in ?? 3600),
    user: data.user,
  }

  return {
    cookies: [],
    origins: [
      {
        origin: options.origin,
        localStorage: [
          {
            name: getSupabaseStorageKey(supabaseUrl),
            value: JSON.stringify(session),
          },
        ],
      },
    ],
  }
}
