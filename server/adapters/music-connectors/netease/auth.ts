import type {
  ConnectedMusicAccount,
  ConnectorAuthContinueInput,
  ConnectorAuthTransition,
  MusicConnectorAuth,
} from '@server/usecases/ports'
import type { ConnectorAuthChallenge } from '@shared/types'
import { eapiRequest, ensureAnonymousSession, mergeCookies, NETEASE_BASE, neteaseError, weapiRequest } from './client'
import type { NeteaseProfile, NeteaseRiskData } from './types'

type NeteaseAuthState =
  | {
      phase: 'qr_login'
      key: string
      cookies: string[]
      expiresAt: string
    }
  | {
      phase: 'sms_code'
      countryCode: string
      phone: string
      cookies: string[]
      expiresAt: string
    }
  | {
      phase: 'verification'
      qrCode: string
      qrUrl: string
      cookies: string[]
      expiresAt: string
      resume: { method: 'qr'; key: string } | { method: 'sms'; countryCode: string; phone: string; code: string }
    }

type NeteaseLoginResult =
  | { status: 'waiting_scan' | 'waiting_confirmation' | 'expired'; cookies: string[] }
  | { status: 'connected'; cookies: string[]; account: ConnectedMusicAccount }
  | {
      status: 'verification_required'
      cookies: string[]
      verification: { qrCode: string; qrUrl: string; expiresAt: string }
    }

export const neteaseAuth: MusicConnectorAuth = {
  async start({ method, input }) {
    if (method === 'qr') return startQrLogin()
    if (method === 'sms') return startSmsLogin(input)
    throw new Error(`Netease does not support ${method} authentication.`)
  },

  async continue(value, input) {
    const state = parseAuthState(value)
    if (state.phase === 'qr_login') {
      requireAction(input, 'poll')
      return continueQrLogin(state)
    }
    if (state.phase === 'sms_code') {
      requireAction(input, 'submit_code')
      return continueSmsLogin(state, requiredSmsCode(input.input.code))
    }
    requireAction(input, 'poll')
    return continueVerification(state)
  },
}

async function startQrLogin(): Promise<ConnectorAuthTransition> {
  const response = await eapiRequest<{
    code?: number
    message?: string
    unikey?: string
    data?: { unikey?: string }
  }>('/api/login/qrcode/unikey', { type: 3 }, [])
  const key = response.body.data?.unikey ?? response.body.unikey
  if (!key) {
    throw new Error(
      `Netease did not return a QR login key (code ${response.body.code ?? 'unknown'}${response.body.message ? `: ${response.body.message}` : ''}).`,
    )
  }
  const expiresAt = loginExpiration()
  return {
    status: 'pending',
    state: { phase: 'qr_login', key, cookies: response.cookies, expiresAt } satisfies NeteaseAuthState,
    challenge: qrChallenge(
      `${NETEASE_BASE}/login?codekey=${encodeURIComponent(key)}`,
      'login',
      'waiting_scan',
      expiresAt,
    ),
  }
}

async function startSmsLogin(input: Record<string, string>): Promise<ConnectorAuthTransition> {
  const countryCode = requiredCountryCode(input.countryCode)
  const phone = requiredPhone(input.phone)
  await sendSmsCode(countryCode, phone)
  const expiresAt = loginExpiration()
  return {
    status: 'pending',
    state: { phase: 'sms_code', countryCode, phone, cookies: [], expiresAt } satisfies NeteaseAuthState,
    challenge: {
      type: 'form',
      action: 'submit_code',
      fields: [{ name: 'code', type: 'text', required: true }],
      expiresAt,
    },
  }
}

async function continueQrLogin(state: Extract<NeteaseAuthState, { phase: 'qr_login' }>) {
  const result = await checkQrLogin(state.key, state.cookies)
  return mapLoginResult(result, { method: 'qr', key: state.key }, state.expiresAt)
}

async function continueSmsLogin(state: Extract<NeteaseAuthState, { phase: 'sms_code' }>, code: string) {
  const resume = { method: 'sms', countryCode: state.countryCode, phone: state.phone, code } as const
  const result = await loginWithSms(resume, state.cookies)
  return mapLoginResult(result, resume, state.expiresAt)
}

async function continueVerification(state: Extract<NeteaseAuthState, { phase: 'verification' }>) {
  const result = await checkRiskVerification(state.qrCode, state.cookies)
  if (result.status === 'expired') return { status: 'expired' } as const
  if (result.status !== 'connected') {
    return {
      status: 'pending',
      state: { ...state, cookies: result.cookies },
      challenge: qrChallenge(state.qrUrl, 'verification', result.status, state.expiresAt),
    } as const
  }

  if (state.resume.method === 'qr') {
    const login = await checkQrLogin(state.resume.key, result.cookies)
    return mapLoginResult(login, state.resume, state.expiresAt)
  }
  const login = await loginWithSms(state.resume, result.cookies)
  return mapLoginResult(login, state.resume, state.expiresAt)
}

function mapLoginResult(
  result: NeteaseLoginResult,
  resume: Extract<NeteaseAuthState, { phase: 'verification' }>['resume'],
  expiresAt: string,
): ConnectorAuthTransition {
  if (result.status === 'connected') {
    return { status: 'connected', credentials: result.cookies, account: result.account }
  }
  if (result.status === 'expired') return { status: 'expired' }
  if (result.status === 'verification_required') {
    return {
      status: 'pending',
      state: {
        phase: 'verification',
        qrCode: result.verification.qrCode,
        qrUrl: result.verification.qrUrl,
        cookies: result.cookies,
        expiresAt: result.verification.expiresAt,
        resume,
      } satisfies NeteaseAuthState,
      challenge: qrChallenge(result.verification.qrUrl, 'verification', 'waiting_scan', result.verification.expiresAt),
    }
  }
  return {
    status: 'pending',
    state:
      resume.method === 'qr'
        ? ({ phase: 'qr_login', key: resume.key, cookies: result.cookies, expiresAt } satisfies NeteaseAuthState)
        : ({
            phase: 'sms_code',
            countryCode: resume.countryCode,
            phone: resume.phone,
            cookies: result.cookies,
            expiresAt,
          } satisfies NeteaseAuthState),
    challenge:
      resume.method === 'qr'
        ? qrChallenge(
            `${NETEASE_BASE}/login?codekey=${encodeURIComponent(resume.key)}`,
            'login',
            result.status,
            expiresAt,
          )
        : {
            type: 'form',
            action: 'submit_code',
            fields: [{ name: 'code', type: 'text', required: true }],
            expiresAt,
          },
  }
}

async function checkQrLogin(key: string, cookies: string[]): Promise<NeteaseLoginResult> {
  const sessionCookies = await ensureAnonymousSession(cookies)
  const response = await eapiRequest<{ code?: number; message?: string; data?: NeteaseRiskData }>(
    '/api/login/qrcode/client/login',
    { key, type: 3 },
    sessionCookies,
  )
  const mergedCookies = mergeCookies(sessionCookies, response.cookies)
  if (response.body.code === 800) return { status: 'expired', cookies: mergedCookies }
  if (response.body.code === 801) return { status: 'waiting_scan', cookies: mergedCookies }
  if (response.body.code === 802) return { status: 'waiting_confirmation', cookies: mergedCookies }
  if ((response.body.code === -462 || response.body.code === 8821) && response.body.data) {
    const verification = await createRiskVerification(response.body.data, mergedCookies)
    return { status: 'verification_required', cookies: verification.cookies, verification: verification.challenge }
  }
  if (response.body.code !== 803) throw new Error(neteaseError('Netease QR login failed', response.body))
  const account = await getAccount(mergedCookies)
  return { status: 'connected', cookies: account.cookies, account: account.profile }
}

async function sendSmsCode(countryCode: string, phone: string): Promise<void> {
  const response = await weapiRequest<{ code?: number; message?: string }>(
    '/weapi/sms/captcha/sent',
    { ctcode: countryCode, cellphone: phone, secrete: 'music_middleuser_pclogin' },
    [],
  )
  if (response.body.code !== 200) throw new Error(neteaseError('Netease failed to send the SMS code', response.body))
}

async function loginWithSms(
  input: { countryCode: string; phone: string; code: string },
  cookies: string[],
): Promise<NeteaseLoginResult> {
  const sessionCookies = await ensureAnonymousSession(cookies)
  const response = await eapiRequest<{ code?: number; message?: string; data?: NeteaseRiskData }>(
    '/api/w/login/cellphone',
    {
      type: '1',
      https: 'true',
      phone: input.phone,
      countrycode: input.countryCode,
      captcha: input.code,
      remember: 'true',
    },
    sessionCookies,
  )
  if ((response.body.code === -462 || response.body.code === 8860) && response.body.data) {
    const verification = await createRiskVerification(response.body.data, response.cookies)
    return { status: 'verification_required', cookies: verification.cookies, verification: verification.challenge }
  }
  if (response.body.code !== 200) throw new Error(neteaseError('Netease SMS login failed', response.body))
  const account = await getAccount(response.cookies)
  return { status: 'connected', cookies: account.cookies, account: account.profile }
}

async function checkRiskVerification(qrCode: string, cookies: string[]) {
  const response = await weapiRequest<{
    code?: number
    message?: string
    qrCodeStatus?: number
    detailReason?: number
    data?: { qrCodeStatus?: number; detailReason?: number }
  }>('/weapi/frontrisk/verify/qrcodestatus', { qrCode }, cookies)
  const status = response.body.data?.qrCodeStatus ?? response.body.qrCodeStatus
  const detailReason = response.body.data?.detailReason ?? response.body.detailReason
  const mergedCookies = mergeCookies(cookies, response.cookies)
  if (status === 0 && detailReason === 0) return { status: 'waiting_scan', cookies: mergedCookies } as const
  if (status === 10 && detailReason === 0) return { status: 'waiting_confirmation', cookies: mergedCookies } as const
  if (status === 20 && detailReason === 0) return { status: 'connected', cookies: mergedCookies } as const
  if (status === 21) return { status: 'expired', cookies: mergedCookies } as const
  if (detailReason === 303) throw new Error('The Netease verification was scanned by a different account.')
  throw new Error(neteaseError('Netease account verification failed', response.body))
}

function qrChallenge(
  url: string,
  purpose: 'login' | 'verification',
  progress: 'waiting_scan' | 'waiting_confirmation',
  expiresAt: string,
): ConnectorAuthChallenge {
  return { type: 'qr', url, purpose, progress, expiresAt }
}

function requireAction(input: ConnectorAuthContinueInput, expected: string): void {
  if (input.action !== expected) throw new Error(`Netease authentication expects the ${expected} action.`)
}

function parseAuthState(value: unknown): NeteaseAuthState {
  if (!isRecord(value) || typeof value.phase !== 'string') throw new Error('Netease authentication state is invalid.')
  const cookies = stringArray(value.cookies)
  if (value.phase === 'qr_login' && typeof value.key === 'string' && typeof value.expiresAt === 'string') {
    return { phase: value.phase, key: value.key, cookies, expiresAt: value.expiresAt }
  }
  if (
    value.phase === 'sms_code' &&
    typeof value.countryCode === 'string' &&
    typeof value.phone === 'string' &&
    typeof value.expiresAt === 'string'
  ) {
    return {
      phase: value.phase,
      countryCode: value.countryCode,
      phone: value.phone,
      cookies,
      expiresAt: value.expiresAt,
    }
  }
  if (
    value.phase === 'verification' &&
    typeof value.qrCode === 'string' &&
    typeof value.qrUrl === 'string' &&
    typeof value.expiresAt === 'string' &&
    isRecord(value.resume)
  ) {
    const resume = value.resume
    if (resume.method === 'qr' && typeof resume.key === 'string') {
      return {
        phase: value.phase,
        qrCode: value.qrCode,
        qrUrl: value.qrUrl,
        cookies,
        expiresAt: value.expiresAt,
        resume: { method: 'qr', key: resume.key },
      }
    }
    if (
      resume.method === 'sms' &&
      typeof resume.countryCode === 'string' &&
      typeof resume.phone === 'string' &&
      typeof resume.code === 'string'
    ) {
      return {
        phase: value.phase,
        qrCode: value.qrCode,
        qrUrl: value.qrUrl,
        cookies,
        expiresAt: value.expiresAt,
        resume: { method: 'sms', countryCode: resume.countryCode, phone: resume.phone, code: resume.code },
      }
    }
  }
  throw new Error('Netease authentication state is invalid.')
}

function requiredCountryCode(value: string | undefined): string {
  if (!value || !/^\d{1,4}$/.test(value)) throw new Error('Netease country code is invalid.')
  return value
}

function requiredPhone(value: string | undefined): string {
  if (!value || !/^\d{5,20}$/.test(value)) throw new Error('Netease phone number is invalid.')
  return value
}

function requiredSmsCode(value: string | undefined): string {
  if (!value || !/^\d{4,8}$/.test(value)) throw new Error('Netease SMS code is invalid.')
  return value
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error('Netease authentication cookies are invalid.')
  }
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function loginExpiration(): string {
  return new Date(Date.now() + 5 * 60_000).toISOString()
}

async function createRiskVerification(data: NeteaseRiskData, cookies: string[]) {
  const params = typeof data.params === 'string' ? (JSON.parse(data.params) as NeteaseRiskData['params']) : data.params
  const eventId = typeof params === 'object' ? params?.event_id : undefined
  const sign = typeof params === 'object' ? params?.sign : undefined
  if (data.verifyId === undefined || data.verifyType === undefined || !data.verifyToken || !eventId || !sign) {
    throw new Error('Netease did not return account verification details.')
  }
  const verificationParams = JSON.stringify({ event_id: eventId, sign })
  const response = await weapiRequest<{ code?: number; message?: string; data?: { qrCode?: string } }>(
    '/weapi/frontrisk/verify/getqrcode',
    {
      verifyConfigId: data.verifyId,
      verifyType: data.verifyType,
      token: data.verifyToken,
      params: verificationParams,
      size: 150,
    },
    cookies,
  )
  const qrCode = response.body.data?.qrCode
  if (!qrCode) throw new Error(neteaseError('Netease did not return an account verification QR code', response.body))
  const query = new URLSearchParams({
    qrCode,
    verifyToken: data.verifyToken,
    verifyId: String(data.verifyId),
    verifyType: String(data.verifyType),
    params: verificationParams,
  })
  return {
    cookies: mergeCookies(cookies, response.cookies),
    challenge: {
      qrCode,
      qrUrl: `https://st.music.163.com/encrypt-pages?${query.toString()}`,
      expiresAt: loginExpiration(),
    },
  }
}

async function getAccount(cookies: string[]) {
  const response = await weapiRequest<{ profile?: NeteaseProfile }>('/weapi/w/nuser/account/get', {}, cookies)
  const profile = response.body.profile
  if (!profile?.userId || !profile.nickname) throw new Error('Netease account profile is unavailable.')
  return {
    cookies: mergeCookies(cookies, response.cookies),
    profile: {
      externalAccountId: String(profile.userId),
      displayName: profile.nickname,
      avatarUrl: profile.avatarUrl ?? null,
    },
  }
}
