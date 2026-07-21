import {
  decryptConnectorCredentials,
  encryptConnectorCredentials,
  validateConnectorCredentialsSecret,
} from '@server/domain/connector-credentials'
import type { Env } from '@server/env'
import type { ConnectorLoginAttempt, ConnectorSummary, NeteaseSmsCodeInput, NeteaseSmsLoginInput } from '@shared/types'
import { syncConnector, toConnectorSummary } from '../connectors'
import type { Deps } from '../deps'
import type {
  ConnectedMusicAccount,
  ConnectorLoginAttemptRecord,
  MusicConnectorModule,
  MusicQrLoginResult,
} from '../ports'

export async function beginNeteaseLogin(deps: Deps, env: Env, userId: string): Promise<ConnectorLoginAttempt> {
  validateConnectorCredentialsSecret(env.CONNECTOR_CREDENTIALS_SECRET)
  const qrAuth = getMusicConnector(deps, 'netease').auth.qr
  if (!qrAuth) throw new Error('Netease QR login is not supported.')
  const login = await qrAuth.beginQrLogin()
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  await deps.connectorLoginAttemptsRepo.create({
    id,
    userId,
    kind: 'netease',
    externalKey: login.key,
    credentialsEncrypted: await encryptConnectorCredentials(env.CONNECTOR_CREDENTIALS_SECRET, login.cookies),
    status: 'waiting_scan',
    expiresAt: login.expiresAt,
    createdAt: now,
    updatedAt: now,
  })
  return { id, kind: 'netease', qrUrl: login.qrUrl, status: 'waiting_scan', expiresAt: login.expiresAt }
}

export async function checkNeteaseLogin(
  deps: Deps,
  env: Env,
  userId: string,
  attemptId: string,
): Promise<{ attempt: ConnectorLoginAttempt; connector: ConnectorSummary | null }> {
  const attempt = await deps.connectorLoginAttemptsRepo.get(userId, attemptId)
  if (!attempt) throw new Error('Connector login attempt was not found.')
  if (Date.parse(attempt.expiresAt) <= Date.now()) {
    await deps.connectorLoginAttemptsRepo.update(userId, attempt.id, {
      status: 'expired',
      updatedAt: new Date().toISOString(),
    })
    return { attempt: toLoginAttempt(attempt, 'expired'), connector: null }
  }
  if (!attempt.credentialsEncrypted) throw new Error('Connector login attempt has no credentials.')

  const credentials = await decryptConnectorCredentials(env.CONNECTOR_CREDENTIALS_SECRET, attempt.credentialsEncrypted)
  const riskVerification = parseRiskVerification(attempt.externalKey)
  if (riskVerification) {
    const auth = getMusicConnector(deps, 'netease').auth
    if (!auth.verification || !auth.qr) throw new Error('Netease account verification is not supported.')
    const result = await auth.verification.checkRiskVerification(riskVerification.qrCode, credentials)
    if (result.status === 'connected' && riskVerification.loginKey) {
      const resumed = await auth.qr.checkQrLogin(riskVerification.loginKey, result.cookies)
      return saveQrLoginResult(deps, env, userId, attempt, riskVerification.loginKey, resumed)
    }
    await deps.connectorLoginAttemptsRepo.update(userId, attempt.id, {
      status: result.status,
      credentialsEncrypted: await encryptConnectorCredentials(env.CONNECTOR_CREDENTIALS_SECRET, result.cookies),
      updatedAt: new Date().toISOString(),
    })
    return { attempt: toLoginAttempt(attempt, result.status), connector: null }
  }

  const qrAuth = getMusicConnector(deps, 'netease').auth.qr
  if (!qrAuth) throw new Error('Netease QR login is not supported.')
  const result = await qrAuth.checkQrLogin(attempt.externalKey, credentials)
  return saveQrLoginResult(deps, env, userId, attempt, attempt.externalKey, result)
}

async function saveQrLoginResult(
  deps: Deps,
  env: Env,
  userId: string,
  attempt: ConnectorLoginAttemptRecord,
  loginKey: string,
  result: MusicQrLoginResult,
): Promise<{ attempt: ConnectorLoginAttempt; connector: ConnectorSummary | null }> {
  const encrypted = await encryptConnectorCredentials(env.CONNECTOR_CREDENTIALS_SECRET, result.cookies)
  if (result.status === 'verification_required') {
    const externalKey = encodeRiskVerification(result.verification, loginKey)
    await deps.connectorLoginAttemptsRepo.update(userId, attempt.id, {
      externalKey,
      status: 'waiting_scan',
      expiresAt: result.verification.expiresAt,
      credentialsEncrypted: encrypted,
      updatedAt: new Date().toISOString(),
    })
    return {
      attempt: toLoginAttempt({ ...attempt, externalKey, expiresAt: result.verification.expiresAt }, 'waiting_scan'),
      connector: null,
    }
  }

  await deps.connectorLoginAttemptsRepo.update(userId, attempt.id, {
    externalKey: loginKey,
    status: result.status,
    credentialsEncrypted: encrypted,
    updatedAt: new Date().toISOString(),
  })

  if (result.status !== 'connected') {
    return { attempt: toLoginAttempt(attempt, result.status), connector: null }
  }

  const connector = await saveConnectedNeteaseConnector(deps, env, userId, result.account, encrypted)
  return { attempt: toLoginAttempt(attempt, 'connected'), connector }
}

export function sendNeteaseSmsCode(deps: Deps, input: NeteaseSmsCodeInput): Promise<void> {
  const smsAuth = getMusicConnector(deps, 'netease').auth.sms
  if (!smsAuth) throw new Error('Netease SMS login is not supported.')
  return smsAuth.sendSmsCode(input)
}

export async function loginNeteaseWithSms(
  deps: Deps,
  env: Env,
  userId: string,
  input: NeteaseSmsLoginInput,
): Promise<{ connector: ConnectorSummary | null; verification: ConnectorLoginAttempt | null }> {
  validateConnectorCredentialsSecret(env.CONNECTOR_CREDENTIALS_SECRET)
  let credentials: string[] = []
  if (input.verificationAttemptId) {
    const attempt = await deps.connectorLoginAttemptsRepo.get(userId, input.verificationAttemptId)
    if (!attempt || !parseRiskVerification(attempt.externalKey)) {
      throw new Error('Netease account verification attempt was not found.')
    }
    if (attempt.status !== 'connected' || Date.parse(attempt.expiresAt) <= Date.now()) {
      throw new Error('Netease account verification is not complete.')
    }
    if (!attempt.credentialsEncrypted) throw new Error('Netease account verification has no credentials.')
    credentials = await decryptConnectorCredentials(env.CONNECTOR_CREDENTIALS_SECRET, attempt.credentialsEncrypted)
  }

  const smsAuth = getMusicConnector(deps, 'netease').auth.sms
  if (!smsAuth) throw new Error('Netease SMS login is not supported.')
  const result = await smsAuth.loginWithSms(input, credentials)
  const encrypted = await encryptConnectorCredentials(env.CONNECTOR_CREDENTIALS_SECRET, result.cookies)
  if (result.status === 'verification_required') {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    await deps.connectorLoginAttemptsRepo.create({
      id,
      userId,
      kind: 'netease',
      externalKey: encodeRiskVerification(result.verification),
      credentialsEncrypted: encrypted,
      status: 'waiting_scan',
      expiresAt: result.verification.expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    return {
      connector: null,
      verification: {
        id,
        kind: 'netease',
        qrUrl: result.verification.qrUrl,
        status: 'waiting_scan',
        expiresAt: result.verification.expiresAt,
      },
    }
  }

  const connector = await saveConnectedNeteaseConnector(deps, env, userId, result.account, encrypted)
  return { connector, verification: null }
}

async function saveConnectedNeteaseConnector(
  deps: Deps,
  env: Env,
  userId: string,
  account: ConnectedMusicAccount,
  credentialsEncrypted: string,
): Promise<ConnectorSummary> {
  const record = await deps.connectorsRepo.save(userId, 'netease', {
    externalAccountId: account.externalAccountId,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    settings: {},
    credentialsEncrypted,
    status: 'connected',
    enabled: true,
  })
  await syncConnector(deps, env, userId, record.id, 'login')
  const synced = await deps.connectorsRepo.get(userId, record.id)
  return synced ? toConnectorSummary(deps, synced) : toConnectorSummary(deps, record)
}

function toLoginAttempt(
  record: { id: string; kind: string; externalKey: string; expiresAt: string },
  status: ConnectorLoginAttempt['status'],
): ConnectorLoginAttempt {
  if (record.kind !== 'netease') throw new Error('Unsupported connector login attempt kind.')
  const riskVerification = parseRiskVerification(record.externalKey)
  return {
    id: record.id,
    kind: record.kind,
    qrUrl: riskVerification?.qrUrl ?? `https://music.163.com/login?codekey=${encodeURIComponent(record.externalKey)}`,
    status,
    expiresAt: record.expiresAt,
  }
}

function getMusicConnector(deps: Deps, kind: string): MusicConnectorModule {
  const module = deps.musicConnectors.get(kind)
  if (!module) throw new Error(`Unsupported music connector: ${kind}.`)
  return module
}

function encodeRiskVerification(value: { qrCode: string; qrUrl: string }, loginKey?: string): string {
  return `risk:${JSON.stringify(loginKey ? { ...value, loginKey } : value)}`
}

function parseRiskVerification(value: string): { qrCode: string; qrUrl: string; loginKey?: string } | null {
  if (!value.startsWith('risk:')) return null
  const parsed = JSON.parse(value.slice('risk:'.length)) as {
    qrCode?: unknown
    qrUrl?: unknown
    loginKey?: unknown
  }
  if (typeof parsed.qrCode !== 'string' || typeof parsed.qrUrl !== 'string') {
    throw new Error('Netease account verification data is invalid.')
  }
  if (parsed.loginKey !== undefined && typeof parsed.loginKey !== 'string') {
    throw new Error('Netease account verification login key is invalid.')
  }
  return { qrCode: parsed.qrCode, qrUrl: parsed.qrUrl, loginKey: parsed.loginKey }
}
