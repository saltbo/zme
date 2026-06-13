// Barrel: `@/lib/api` stays the single import surface. Modules mirror server/http/.

export * from './books'
export { ApiError } from './client'
export * from './downloaders'
export * from './downloads'
export * from './indexers'
export * from './library'
export * from './media'
export * from './media-sources'
export * from './music'
export * from './setup'
