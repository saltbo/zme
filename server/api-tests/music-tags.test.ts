import { prepareMusicFile } from '@server/music-tags'
import { describe, expect, it } from 'vitest'

const AAC_SAMPLE =
  '//FQQCE//N4CAExhdmM2Mi4yOC4xMDEAAmCsW6lQcialePXj9664ltVJapaVJMk7g6EBBhVy8Xca6S1r2l5jwbtjzur5PFLYMz5L55010jzdzbuLYOUuI6+1TbVs2VTtVZ91ViOFY3FXGzaDZsbYsTcrLcs517E47G4q42a4z1Zjo1+avzV+axz62fW1LPUsdGvzWmavzV+fWz62fWz6qfX5rDNYabOizorUVqKVNjMxmYzMaK1FaitRY02MzGZjExos6K1FaixosZmMzGJKJKeKeKJKJfC+S+SUSU8U8U8US+S+S+S+8U8U8U8US+S/FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFwP/xUEAhP/wBNJra0k3AbMVMJsxUonTdTann61fDb41d1/6cfr9XBd6n/9Lz+vxwGrm//7fX7+0hq+M6El0EF/iaMDDx5cB9k07sFil8NqJhdcGa0gu2J3ONIh8LF2uNghxsWpqprUEKl1U2cz/xtDXbv6zokGBruQSEgwMDZO4SEhIMDAzu4SEnAYcy7uEnGgZkGvO75BITkvz8wNkZoTYS7/CFWGmriOkGSlFKpI3MrNnZVG5pa2222TRaRSmzmSqqi0zqYG+TA39ZCQYkDAwSEkrzgxs2EhJUGzcGBjYSElb2OaLGUJK3YCCDLw4WY5eI+11/eH02VZV+U6JCTk00yVZyaYJS3eD/8VBAE1/8ARb2LPS2MRde7z3+c/xr6zXC2LpJJuSHhIiSLpdCA8Y59859Z/04jzDEZND8I5ruBzV9VlXyzOy7T978Dxmwwr1nXVurcayqOcsbLnO04mwqThmTZs2NFRCsWrVrg4NjjjjMwPXhhg4g02OOLID14YSO4NTjjMyA/v7wn+PhtPv7kf4+G0+/uT/j8GT7+8ozfBuA//FQQBe//AESVi2U7RMLXO8rn+n/M+t9aPPNyxaHnIvVWlXlpljtT7hpDuDjT1j1j7hqWZBS6VV+8fUPyHrhBqyCC/ZNmbcWbn43/z/x/yez8eNZOOdU6ptFgxiXj/q+17Xi49WJIYjaNoyiMIHk872va8XHuRJCyYjERig4dvPz8/JqzxGDScnIxQcO3k5+PblxAGGjRo0MHDt27ePNlngGGjRQYAOHbjrK5ZZZRcgKueeamBXXZXQAGufA//FQQCL//AEsm7LbRIKs1mQy+tgfPrzbi0uXr/+35/Xq+glz/+p+v34vys6ZIOlqjDB5mhcekBAw5y9t37i13RJhv6rGLV14aJPJ101zPhjjhS80jPhjhjTWzs7PhjWwSEpZgYGCQkJmmcGBgYJCQmZ3BgYGCalszuDIgbDh9aI/nVD1600bPdv1QoypVaus9G17uJoBevKbGJaF/GrDJpHxfxrEwcxYXlVhdjQkuU561xnKsSZNAuXDlwfYp2OagBgIigp5vJjgZM4oIAmOGOGMiCgoo/l/L+V73H8v5fyValX8v5fy9U4AfD+X8tfz2N9g2TRjn40wviGo966GqUH2bznmbXOlKXpzC6o22NYtBYlCYQ5+//FQQAGf/AEYgbRw'

const tags = {
  title: 'Workers 标签验收',
  artists: ['歌手甲', '歌手乙'],
  album: 'Workers 专辑',
  albumArtists: ['专辑歌手'],
  trackNumber: 2,
  discNumber: 1,
  releaseDate: '2024-03-02',
  compilation: false,
  coverUrl: 'https://p3.music.126.net/test-cover.jpg',
}

describe('music tags in the Workers runtime', () => {
  it('loads the buffered tag engine and writes AAC text and artwork', async () => {
    const source = Uint8Array.from(atob(AAC_SAMPLE), (character) => character.charCodeAt(0))
    const first = await prepareMusicFile(stream(source), 'aac', tags, source.byteLength, async () => ({
      mimeType: 'image/jpeg',
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    }))

    expect(first.changed).toBe(true)
    const tagged = await readAll(first.body)
    expect(tagged.byteLength).toBeGreaterThan(source.byteLength)

    const second = await prepareMusicFile(stream(tagged), 'aac', tags, tagged.byteLength)
    expect(second).toEqual({ changed: false, body: null, contentLength: tagged.byteLength })
  })
})

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

async function readAll(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!body) throw new Error('Expected a response body.')
  const chunks: Uint8Array[] = []
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
