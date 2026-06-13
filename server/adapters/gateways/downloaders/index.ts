import type { DownloaderGateway, DownloadTaskGateway } from '@server/usecases/ports'
import type { DownloaderKind } from '@shared/types'
import { aria2DownloaderGateway } from './aria2'
import { qbittorrentDownloaderGateway } from './qbittorrent'
import { transmissionDownloaderGateway } from './transmission'
import { zpanDownloaderGateway, zpanDownloadTaskGateway } from './zpan'

export const downloaderGateways: Record<DownloaderKind, DownloaderGateway> = {
  zpan: zpanDownloaderGateway,
  qbittorrent: qbittorrentDownloaderGateway,
  transmission: transmissionDownloaderGateway,
  aria2: aria2DownloaderGateway,
}

/** Downloaders that expose remote task listing/streaming. */
export const downloadTaskGateways: Partial<Record<DownloaderKind, DownloadTaskGateway>> = {
  zpan: zpanDownloadTaskGateway,
}
