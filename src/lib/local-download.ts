import { createDownload } from './api/downloads'

export async function startLocalDownload(resourceRef: string) {
  const source = await createDownload({ resourceRef })
  const link = document.createElement('a')
  link.href = source.href
  link.referrerPolicy = 'no-referrer'
  document.body.append(link)
  link.click()
  link.remove()
}
