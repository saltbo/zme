import { env } from 'cloudflare:test'
import {
  createDispatchLanesRepo,
  createDownloadRecordsRepo,
  createMediaSubscriptionsRepo,
} from '@server/adapters/repos/media-downloads'
import { createDb } from '@server/db/client'
import type { DownloadRecordRecord } from '@server/usecases/ports'
import { beforeEach, describe, expect, it } from 'vitest'

const USER_ID = 'download-test-user'
const DOWNLOADER_ID = 'download-test-downloader'
const NOW = '2026-07-20T00:00:00.000Z'

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO user (id, name, email, email_verified, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(USER_ID, 'Download Tester', 'downloads@zme.test', 1, 'admin', Date.now(), Date.now()),
    env.DB.prepare(
      'INSERT INTO downloaders (id, user_id, kind, endpoint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(DOWNLOADER_ID, USER_ID, 'zpan', 'https://zpan.test', NOW, NOW),
  ])
})

describe('media download repositories in D1', () => {
  it('creates, reads, links, and cancels a large subscription without exceeding D1 variables', async () => {
    const db = createDb(env)
    const subscriptions = createMediaSubscriptionsRepo(db)
    const downloads = createDownloadRecordsRepo(db)
    const subscription = await subscriptions.upsertMusicCollection(USER_ID, 'playlist-1', {
      downloaderId: DOWNLOADER_ID,
      now: NOW,
    })
    const records = Array.from({ length: 120 }, (_, index) => record(index))

    await downloads.createMany(records)
    const stored = await downloads.listByResourceKeys(
      USER_ID,
      'music_track',
      records.map((item) => item.resourceKey),
    )
    await downloads.linkSubscriptionMany(
      subscription.id,
      stored.map((item) => item.id),
      NOW,
    )
    await subscriptions.disable(USER_ID, subscription.id, '2026-07-20T01:00:00.000Z')
    const canceled = await downloads.cancelUnwantedForSubscription(subscription.id, '2026-07-20T01:00:00.000Z')

    expect(stored).toHaveLength(120)
    expect(canceled).toBe(120)
    expect(
      await downloads.listByResourceKeys(
        USER_ID,
        'music_track',
        records.map((item) => item.resourceKey),
      ),
    ).toSatisfy((items: DownloadRecordRecord[]) => items.every((item) => item.status === 'canceled'))
  })

  it('allows only one owner to acquire a lane until its cooldown expires', async () => {
    const lanes = createDispatchLanesRepo(createDb(env))
    const acquiredAt = '2026-07-20T00:00:00.000Z'
    const leaseExpiresAt = '2026-07-20T00:01:00.000Z'

    const first = await lanes.acquire('netease:connector-1', 'owner-1', acquiredAt, leaseExpiresAt)
    const second = await lanes.acquire(
      'netease:connector-1',
      'owner-2',
      '2026-07-20T00:00:01.000Z',
      '2026-07-20T00:01:01.000Z',
    )
    await lanes.release('netease:connector-1', 'owner-1', '2026-07-20T00:00:20.000Z', '2026-07-20T00:00:10.000Z')
    const cooling = await lanes.acquire(
      'netease:connector-1',
      'owner-2',
      '2026-07-20T00:00:15.000Z',
      '2026-07-20T00:01:15.000Z',
    )
    const afterCooldown = await lanes.acquire(
      'netease:connector-1',
      'owner-2',
      '2026-07-20T00:00:20.000Z',
      '2026-07-20T00:01:20.000Z',
    )

    expect(first.acquired).toBe(true)
    expect(second.acquired).toBe(false)
    expect(cooling.acquired).toBe(false)
    expect(afterCooldown.acquired).toBe(true)
  })
})

function record(index: number): DownloadRecordRecord {
  return {
    id: `download-${index}`,
    userId: USER_ID,
    resourceKind: 'music_track',
    resourceKey: `netease:track:${index}`,
    laneKey: 'netease:connector-1',
    generation: 1,
    downloaderId: DOWNLOADER_ID,
    config: { preferredQuality: 'exhigh', resolvedQuality: null },
    status: 'queued',
    attemptCount: 0,
    externalTaskId: null,
    firstAcceptedAt: null,
    lastAcceptedAt: null,
    manualRequestedAt: null,
    errorMessage: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}
