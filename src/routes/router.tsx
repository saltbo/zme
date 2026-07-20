import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { AuthenticatedShell } from '@/components/app-shell/authenticated-shell'
import { useAuth } from '@/contexts/auth'
import { AuthGate } from '@/routes/auth-gate'
import { DownloadsPage } from '@/routes/downloads'
import { IndexersPage } from '@/routes/indexers'
import { LibraryBooksPage, LibraryMediaPage } from '@/routes/library'
import { MusicCollectionDetailPage, MusicLibraryCollectionsPage } from '@/routes/library-music'
import { MediaDetailPage } from '@/routes/media-detail'
import { MediaSeasonDetailPage } from '@/routes/media-season-detail'
import { MediaSourcesPage } from '@/routes/media-sources'
import { MediaWorkspace } from '@/routes/media-workspace'
import { PersonCreditsPage } from '@/routes/person-credits'
import { BookReleaseSearchPage, MediaReleaseSearchPage } from '@/routes/release-search'
import { BookDetailPage, BooksPage, MusicDetailPage, MusicPage } from '@/routes/resource-pages'
import { SettingsPage } from '@/routes/settings'
import { UsersPage } from '@/routes/users'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AuthGate />,
    children: [
      {
        path: 'onboarding',
        element: null,
      },
      {
        path: 'login',
        element: null,
      },
      {
        element: <AuthenticatedShell />,
        children: [
          {
            index: true,
            element: <MediaWorkspace mode="discover" />,
          },
          {
            path: 'movies',
            element: <MediaWorkspace mode="movie" />,
          },
          {
            path: 'movies/:id',
            element: <MediaDetailPage kind="movie" />,
          },
          {
            path: 'movies/:id/releases',
            element: <MediaReleaseSearchPage kind="movie" />,
          },
          {
            path: 'series',
            element: <MediaWorkspace mode="tv" />,
          },
          {
            path: 'animations',
            element: <MediaWorkspace mode="animation" />,
          },
          {
            path: 'music',
            element: <MusicPage />,
          },
          {
            path: 'music/:key',
            element: <MusicDetailPage />,
          },
          {
            path: 'books',
            element: <BooksPage />,
          },
          {
            path: 'books/:key',
            element: <BookDetailPage />,
          },
          {
            path: 'books/:key/releases/:target',
            element: <BookReleaseSearchPage />,
          },
          {
            path: 'series/:id',
            element: <MediaDetailPage kind="tv" />,
          },
          {
            path: 'series/:id/releases',
            element: <MediaReleaseSearchPage kind="tv" />,
          },
          {
            path: 'series/:id/seasons/:seasonNumber',
            element: <MediaSeasonDetailPage />,
          },
          {
            path: 'people/:id',
            element: <PersonCreditsPage />,
          },
          {
            path: 'library',
            element: <Navigate to="/library/media" replace />,
          },
          {
            path: 'library/media',
            element: <LibraryMediaPage />,
          },
          {
            path: 'library/books',
            element: <LibraryBooksPage />,
          },
          {
            path: 'library/music',
            element: <Navigate to="/library/music/playlists" replace />,
          },
          {
            path: 'library/music/playlists',
            element: <MusicLibraryCollectionsPage kind="playlist" />,
          },
          {
            path: 'library/music/playlists/:collectionId',
            element: <MusicCollectionDetailPage />,
          },
          {
            path: 'library/music/albums',
            element: <MusicLibraryCollectionsPage kind="album" />,
          },
          {
            path: 'library/music/albums/:collectionId',
            element: <MusicCollectionDetailPage />,
          },
          {
            path: 'downloads',
            element: <DownloadsPage />,
          },
          {
            path: 'settings',
            element: <SettingsPage />,
          },
          {
            path: 'admin/users',
            element: (
              <AdminRoute>
                <UsersPage />
              </AdminRoute>
            ),
          },
          {
            path: 'admin/media-sources',
            element: (
              <AdminRoute>
                <MediaSourcesPage />
              </AdminRoute>
            ),
          },
          {
            path: 'admin/indexers',
            element: (
              <AdminRoute>
                <IndexersPage />
              </AdminRoute>
            ),
          },
          {
            path: '*',
            element: <Navigate to="/" replace />,
          },
        ],
      },
    ],
  },
])

function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/" replace />

  return children
}
