import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { parseFile } from 'music-metadata'
import { prepareMusicFile } from '../server/music-tags/index.ts'

const samples = [
  { extension: 'mp3', args: ['-c:a', 'libmp3lame'] },
  { extension: 'flac', args: ['-c:a', 'flac'] },
  { extension: 'aac', args: ['-c:a', 'aac', '-f', 'adts'] },
  { extension: 'm4a', args: ['-c:a', 'aac'] },
  { extension: 'ogg', args: ['-ac', '2', '-c:a', 'vorbis', '-strict', '-2'] },
]

const tags = {
  title: '标签验收歌曲',
  artists: ['歌手甲', '歌手乙'],
  album: '标签验收专辑',
  albumArtists: ['专辑歌手'],
  trackNumber: 2,
  discNumber: 1,
  releaseDate: '2024-03-02',
  compilation: false,
  coverUrl: 'https://p3.music.126.net/test-cover.jpg',
}

const MAX_WEBDAV_METADATA_PREFIX_BYTES = 128 * 1024

const directory = await mkdtemp(path.join(tmpdir(), 'zme-music-tags-'))
try {
  const coverPath = path.join(directory, 'cover.jpg')
  run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1', coverPath, '-y'])
  const cover = new Uint8Array(await readFile(coverPath))

  for (const sample of samples) {
    const sourcePath = path.join(directory, `source.${sample.extension}`)
    const taggedPath = path.join(directory, `tagged.${sample.extension}`)
    run('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1',
      ...sample.args,
      sourcePath,
      '-y',
    ])
    await verifySource(sourcePath, taggedPath, sample.extension, cover, sample.extension)
  }

  const realSourcePaths = process.argv.slice(2).filter((argument) => argument !== '--')
  for (const realSourcePath of realSourcePaths) {
    const extension = path.extname(realSourcePath).slice(1).toLowerCase()
    await verifySource(
      realSourcePath,
      path.join(directory, `tagged-real-${path.basename(realSourcePath)}`),
      extension,
      cover,
      `real ${path.basename(realSourcePath)}`,
    )
  }
} finally {
  await rm(directory, { recursive: true })
}

async function verifySource(sourcePath, taggedPath, extension, cover, label) {
  const source = new Uint8Array(await readFile(sourcePath))
  const prepared = await prepareMusicFile(stream(source), extension, tags, source.byteLength, async () => ({
    mimeType: 'image/jpeg',
    bytes: cover,
  }))
  assert.equal(prepared.changed, true)
  const output = await readAll(prepared.body)
  await writeFile(taggedPath, output)

  assert.equal(await decodedAudioHash(sourcePath), await decodedAudioHash(taggedPath))
  const metadata = await parseFile(taggedPath)
  assert.equal(metadata.common.title, tags.title)
  assert.equal(metadata.common.album, tags.album)
  assert.equal(metadata.common.albumartist, tags.albumArtists.join('; '))
  assert.equal(metadata.common.track.no, tags.trackNumber)
  assert.equal(metadata.common.disk.no, tags.discNumber)
  if (extension === 'mp3' && metadata.common.date === undefined) {
    assert.equal(metadata.common.year, Number(tags.releaseDate.slice(0, 4)))
  } else {
    assert.equal(metadata.common.date, tags.releaseDate)
  }
  assert.deepEqual(metadata.common.picture?.[0]?.data, cover)
  if (extension === 'mp3' || extension === 'flac') {
    assert.ok(
      metadataPrefixLength(output, extension) <= MAX_WEBDAV_METADATA_PREFIX_BYTES,
      `${label} metadata exceeds the WebDAV scan prefix`,
    )
  }

  const second = await prepareMusicFile(stream(output), extension, tags, output.byteLength)
  assert.deepEqual(second, { changed: false, body: null, contentLength: output.byteLength })
  process.stdout.write(`verified ${label}: tags, artwork, decoding, and idempotence\n`)
}

function metadataPrefixLength(bytes, extension) {
  if (extension === 'mp3') {
    assert.equal(new TextDecoder().decode(bytes.subarray(0, 3)), 'ID3')
    return 10 + ((bytes[6] & 0x7f) << 21) + ((bytes[7] & 0x7f) << 14) + ((bytes[8] & 0x7f) << 7) + (bytes[9] & 0x7f)
  }

  assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'fLaC')
  let offset = 4
  while (true) {
    const last = (bytes[offset] & 0x80) !== 0
    const length = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
    offset += 4 + length
    if (last) return offset
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, encoding: options.encoding ?? 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`)
  }
  return result
}

async function decodedAudioHash(filePath) {
  const process = spawn('ffmpeg', [
    '-v',
    'error',
    '-i',
    filePath,
    '-map',
    '0:a:0',
    '-f',
    's16le',
    '-acodec',
    'pcm_s16le',
    '-',
  ])
  const hash = createHash('sha256')
  let errorOutput = ''
  process.stdout.on('data', (chunk) => hash.update(chunk))
  process.stderr.setEncoding('utf8')
  process.stderr.on('data', (chunk) => {
    errorOutput += chunk
  })
  const exitCode = await new Promise((resolve, reject) => {
    process.once('error', reject)
    process.once('close', resolve)
  })
  if (exitCode !== 0) throw new Error(`ffmpeg failed: ${errorOutput}`)
  return hash.digest('hex')
}

function stream(bytes) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

async function readAll(body) {
  assert(body)
  const chunks = []
  const reader = body.getReader()
  while (true) {
    const next = await reader.read()
    if (next.done) break
    chunks.push(next.value)
  }
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}
