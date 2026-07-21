import type {
  MusicConnectorAuth,
  MusicConnectorQrAuth,
  MusicConnectorSmsAuth,
  MusicConnectorVerificationAuth,
} from '@server/usecases/ports'
import { eapiRequest, ensureAnonymousSession, mergeCookies, NETEASE_BASE, neteaseError, weapiRequest } from './client'
import type { NeteaseProfile, NeteaseRiskData } from './types'

const neteaseAuthMethods: MusicConnectorQrAuth & MusicConnectorSmsAuth & MusicConnectorVerificationAuth = {
  async beginQrLogin() {
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
    return {
      key,
      qrUrl: `${NETEASE_BASE}/login?codekey=${encodeURIComponent(key)}`,
      cookies: response.cookies,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    }
  },

  async checkQrLogin(key, cookies) {
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
  },

  async sendSmsCode({ countryCode, phone }) {
    const response = await weapiRequest<{ code?: number; message?: string }>(
      '/weapi/sms/captcha/sent',
      { ctcode: countryCode, cellphone: phone, secrete: 'music_middleuser_pclogin' },
      [],
    )
    if (response.body.code !== 200) throw new Error(neteaseError('Netease failed to send the SMS code', response.body))
  },

  async loginWithSms({ countryCode, phone, code }, cookies) {
    const sessionCookies = await ensureAnonymousSession(cookies)
    const response = await eapiRequest<{ code?: number; message?: string; data?: NeteaseRiskData }>(
      '/api/w/login/cellphone',
      { type: '1', https: 'true', phone, countrycode: countryCode, captcha: code, remember: 'true' },
      sessionCookies,
    )
    if ((response.body.code === -462 || response.body.code === 8860) && response.body.data) {
      const verification = await createRiskVerification(response.body.data, response.cookies)
      return { status: 'verification_required', cookies: verification.cookies, verification: verification.challenge }
    }
    if (response.body.code !== 200) throw new Error(neteaseError('Netease SMS login failed', response.body))
    const account = await getAccount(response.cookies)
    return { status: 'connected', cookies: account.cookies, account: account.profile }
  },

  async checkRiskVerification(qrCode, cookies) {
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
    if (status === 0 && detailReason === 0) return { status: 'waiting_scan', cookies: mergedCookies }
    if (status === 10 && detailReason === 0) return { status: 'waiting_confirmation', cookies: mergedCookies }
    if (status === 20 && detailReason === 0) return { status: 'connected', cookies: mergedCookies }
    if (status === 21) return { status: 'expired', cookies: mergedCookies }
    if (detailReason === 303) throw new Error('The Netease verification was scanned by a different account.')
    throw new Error(neteaseError('Netease account verification failed', response.body))
  },
}

export const neteaseAuth: MusicConnectorAuth = {
  qr: {
    beginQrLogin: neteaseAuthMethods.beginQrLogin,
    checkQrLogin: neteaseAuthMethods.checkQrLogin,
  },
  sms: {
    sendSmsCode: neteaseAuthMethods.sendSmsCode,
    loginWithSms: neteaseAuthMethods.loginWithSms,
  },
  verification: {
    checkRiskVerification: neteaseAuthMethods.checkRiskVerification,
  },
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
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
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
