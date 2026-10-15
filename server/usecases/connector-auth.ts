import {
  decryptConnectorPayload,
  encryptConnectorPayload,
  validateConnectorCredentialsSecret,
} from '@server/domain/connector-credentials'
import type { Env } from '@server/env'
import type {
  ConnectorLoginAttempt,
  ConnectorLoginResult,
  ConnectorProviderSummary,
  ConnectorSummary,
} from '@shared/types'
import { enqueueConnectorSync, toConnectorSummary } from './connectors'
import type { Deps } from './deps'
import { hashSecret } from './identity'
import type {
  ConnectedMusicAccount,
  ConnectorAuthContinueInput,
  ConnectorAuthStartInput,
  ConnectorAuthTransition,
  ConnectorLoginAttemptRecord,
  MusicConnectorModule,
} from './ports'
import { ResourceConflictError, ResourceNotFoundError } from './resource-errors'

export function listConnectorProviders(deps: Deps): ConnectorProviderSummary[] {
  return [...deps.musicConnectors.values()].map((module) => ({
    kind: module.definition.kind,
    authModes: [...module.definition.authModes],
    capabilities: [...module.definition.capabilities],
  }))
}

export async function startConnectorLogin(
  deps: Deps,
  env: Env,
  userId: string,
  input: { kind: string } & ConnectorAuthStartInput,
): Promise<ConnectorLoginResult> {
  validateConnectorCredentialsSecret(env.CONNECTOR_CREDENTIALS_SECRET)
  const module = getMusicConnector(deps, input.kind)
  if (!module.definition.authModes.includes(input.method)) {
    throw new Error(`Connector ${input.kind} does not support ${input.method} authentication.`)
  }

  const transition = await module.auth.start({ method: input.method, input: input.input })
  const now = new Date().toISOString()
  const attempt = await createAttempt(deps, env, userId, input.kind, input.method, transition, now)
  const connector = await completeConnectorLogin(deps, env, userId, module, transition, attempt.id)
  if (attempt.status === 'pending' && attempt.challenge?.type === 'qr')
    await deps.connectorLoginQueue.enqueue({ userId, attemptId: attempt.id }, 2)
  return { attempt: toLoginAttempt(attempt), connector }
}

export interface ConnectorLoginPollMessage {
  type: 'connector_login_poll'
  userId: string
  attemptId: string
  traceparent?: string
  tracestate?: string
}

export async function processConnectorLoginPoll(
  deps: Deps,
  env: Env,
  message: ConnectorLoginPollMessage,
): Promise<number | null> {
  try {
    return await withLoginLease(deps, message.attemptId, async () => {
      const current = await deps.connectorLoginAttemptsRepo.get(message.userId, message.attemptId)
      if (current?.status !== 'pending' || current.challenge?.type !== 'qr') return null
      const result = await continueConnectorLogin(deps, env, message.userId, message.attemptId, {
        action: 'poll',
        input: {},
      })
      return result.attempt.status === 'pending' && result.attempt.challenge?.type === 'qr' ? 2 : null
    })
  } catch (error) {
    if (error instanceof ResourceConflictError) return 2
    throw error
  }
}

export async function getConnectorChallengeResponse(deps: Deps, userId: string, attemptId: string) {
  const attempt = await getAttempt(deps, userId, attemptId)
  if (!attempt.responseSubmittedAt) throw new ResourceNotFoundError('Challenge response not found.')
  return { attemptId, submittedAt: attempt.responseSubmittedAt }
}

export async function submitConnectorChallengeResponse(
  deps: Deps,
  env: Env,
  userId: string,
  attemptId: string,
  input: Record<string, string>,
) {
  return withLoginLease(deps, attemptId, () => applyConnectorChallengeResponse(deps, env, userId, attemptId, input))
}

async function withLoginLease<T>(deps: Deps, attemptId: string, work: () => Promise<T>): Promise<T> {
  const laneKey = `connector-login:${attemptId}`
  const owner = crypto.randomUUID()
  const now = new Date()
  const lease = await deps.dispatchLanesRepo.acquire(
    laneKey,
    owner,
    now.toISOString(),
    new Date(now.getTime() + 60_000).toISOString(),
  )
  if (!lease.acquired) throw new ResourceConflictError('The login attempt is already being updated.')
  try {
    return await work()
  } finally {
    const releasedAt = new Date().toISOString()
    await deps.dispatchLanesRepo.release(laneKey, owner, releasedAt, releasedAt)
  }
}

async function applyConnectorChallengeResponse(
  deps: Deps,
  env: Env,
  userId: string,
  attemptId: string,
  input: Record<string, string>,
) {
  const current = await getAttempt(deps, userId, attemptId)
  const responseHash = await hashSecret(
    `${env.CONNECTOR_CREDENTIALS_SECRET}:${JSON.stringify(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)))}`,
  )
  if (current.responseHash) {
    if (current.responseHash !== responseHash)
      throw new ResourceConflictError('This challenge already has a different accepted response.')
    return { response: await getConnectorChallengeResponse(deps, userId, attemptId), created: false }
  }
  if (current.status !== 'pending' || current.challenge?.type !== 'form')
    throw new ResourceConflictError('This attempt is not waiting for a form response.')
  const result = await continueConnectorLogin(deps, env, userId, attemptId, { action: current.challenge.action, input })
  const submittedAt = new Date().toISOString()
  const updated = await deps.connectorLoginAttemptsRepo.update(userId, attemptId, {
    responseHash,
    responseSubmittedAt: submittedAt,
  })
  if (!updated) throw new ResourceNotFoundError('Login attempt not found.')
  if (result.attempt.status === 'pending' && result.attempt.challenge?.type === 'qr')
    await deps.connectorLoginQueue.enqueue({ userId, attemptId }, 2)
  return { response: { attemptId, submittedAt }, created: true }
}

export async function getConnectorLoginAttempt(
  deps: Deps,
  userId: string,
  attemptId: string,
): Promise<ConnectorLoginResult> {
  const current = await getAttempt(deps, userId, attemptId)
  const attempt = await expireAttemptIfNeeded(deps, current)
  const connector = attempt.status === 'connected' ? await findConnector(deps, userId, attempt.kind) : null
  return { attempt: toLoginAttempt(attempt), connector }
}

export async function continueConnectorLogin(
  deps: Deps,
  env: Env,
  userId: string,
  attemptId: string,
  input: ConnectorAuthContinueInput,
): Promise<ConnectorLoginResult> {
  validateConnectorCredentialsSecret(env.CONNECTOR_CREDENTIALS_SECRET)
  const current = await getAttempt(deps, userId, attemptId)
  const attempt = await expireAttemptIfNeeded(deps, current)
  if (attempt.status !== 'pending') {
    const connector = attempt.status === 'connected' ? await findConnector(deps, userId, attempt.kind) : null
    return { attempt: toLoginAttempt(attempt), connector }
  }
  if (!attempt.stateEncrypted) throw new Error('Connector login attempt has no provider state.')

  const module = getMusicConnector(deps, attempt.kind)
  const state = await decryptConnectorPayload(env.CONNECTOR_CREDENTIALS_SECRET, attempt.stateEncrypted)
  const transition = await module.auth.continue(state, input)
  const connector = await completeConnectorLogin(deps, env, userId, module, transition, attempt.id)
  const updated = await updateAttempt(deps, env, attempt, transition)
  return { attempt: toLoginAttempt(updated), connector }
}

async function createAttempt(
  deps: Deps,
  env: Env,
  userId: string,
  kind: string,
  method: string,
  transition: ConnectorAuthTransition,
  now: string,
): Promise<ConnectorLoginAttemptRecord> {
  const record = transitionRecord(
    {
      id: crypto.randomUUID(),
      userId,
      kind,
      method,
      stateEncrypted: null,
      challenge: null,
      status: 'pending',
      expiresAt: now,
      createdAt: now,
      updatedAt: now,
    },
    transition,
    await encryptTransitionState(env, transition),
    now,
  )
  await deps.connectorLoginAttemptsRepo.create(record)
  return record
}

async function updateAttempt(
  deps: Deps,
  env: Env,
  attempt: ConnectorLoginAttemptRecord,
  transition: ConnectorAuthTransition,
): Promise<ConnectorLoginAttemptRecord> {
  const now = new Date().toISOString()
  const next = transitionRecord(attempt, transition, await encryptTransitionState(env, transition), now)
  const updated = await deps.connectorLoginAttemptsRepo.update(attempt.userId, attempt.id, {
    stateEncrypted: next.stateEncrypted,
    challenge: next.challenge,
    status: next.status,
    expiresAt: next.expiresAt,
    updatedAt: next.updatedAt,
  })
  if (!updated) throw new ResourceNotFoundError('Connector login attempt was not found.')
  return updated
}

function transitionRecord(
  attempt: ConnectorLoginAttemptRecord,
  transition: ConnectorAuthTransition,
  stateEncrypted: string | null,
  now: string,
): ConnectorLoginAttemptRecord {
  if (transition.status === 'pending') {
    return {
      ...attempt,
      stateEncrypted,
      challenge: transition.challenge,
      status: 'pending',
      expiresAt: transition.challenge.expiresAt,
      updatedAt: now,
    }
  }
  return {
    ...attempt,
    stateEncrypted: null,
    challenge: null,
    status: transition.status,
    expiresAt: now,
    updatedAt: now,
  }
}

function encryptTransitionState(env: Env, transition: ConnectorAuthTransition): Promise<string | null> {
  return transition.status === 'pending'
    ? encryptConnectorPayload(env.CONNECTOR_CREDENTIALS_SECRET, transition.state)
    : Promise.resolve(null)
}

async function completeConnectorLogin(
  deps: Deps,
  env: Env,
  userId: string,
  module: MusicConnectorModule,
  transition: ConnectorAuthTransition,
  attemptId: string,
): Promise<ConnectorSummary | null> {
  if (transition.status !== 'connected') return null
  const credentialsEncrypted = await encryptConnectorPayload(env.CONNECTOR_CREDENTIALS_SECRET, transition.credentials)
  return saveConnectedConnector(deps, userId, module, transition.account, credentialsEncrypted, attemptId)
}

async function saveConnectedConnector(
  deps: Deps,
  userId: string,
  module: MusicConnectorModule,
  account: ConnectedMusicAccount,
  credentialsEncrypted: string,
  attemptId: string,
): Promise<ConnectorSummary> {
  const record = await deps.connectorsRepo.save(userId, module.definition.kind, {
    externalAccountId: account.externalAccountId,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    settings: {},
    credentialsEncrypted,
    status: 'connected',
    enabled: true,
  })
  await enqueueConnectorSync(deps, userId, record.id, `connector-login:${attemptId}`)
  return toConnectorSummary(deps, record)
}

async function expireAttemptIfNeeded(
  deps: Deps,
  attempt: ConnectorLoginAttemptRecord,
): Promise<ConnectorLoginAttemptRecord> {
  if (attempt.status !== 'pending' || Date.parse(attempt.expiresAt) > Date.now()) return attempt
  const updated = await deps.connectorLoginAttemptsRepo.update(attempt.userId, attempt.id, {
    stateEncrypted: null,
    challenge: null,
    status: 'expired',
    updatedAt: new Date().toISOString(),
  })
  if (!updated) throw new ResourceNotFoundError('Connector login attempt was not found.')
  return updated
}

async function getAttempt(deps: Deps, userId: string, attemptId: string): Promise<ConnectorLoginAttemptRecord> {
  const attempt = await deps.connectorLoginAttemptsRepo.get(userId, attemptId)
  if (!attempt) throw new ResourceNotFoundError('Connector login attempt was not found.')
  return attempt
}

async function findConnector(deps: Deps, userId: string, kind: string): Promise<ConnectorSummary | null> {
  const record = await deps.connectorsRepo.findByKind(userId, kind)
  return record ? toConnectorSummary(deps, record) : null
}

function getMusicConnector(deps: Deps, kind: string): MusicConnectorModule {
  const module = deps.musicConnectors.get(kind)
  if (!module) throw new Error(`Unsupported music connector: ${kind}.`)
  return module
}

function toLoginAttempt(record: ConnectorLoginAttemptRecord): ConnectorLoginAttempt {
  return {
    id: record.id,
    kind: record.kind,
    method: record.method,
    status: record.status,
    challenge: record.challenge,
    expiresAt: record.expiresAt,
  }
}
