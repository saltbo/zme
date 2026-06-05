import type { ReactNode } from 'react'
import { createBrowserRouter, Navigate } from 'react-router'
import { AuthenticatedShell } from '@/components/app-shell/authenticated-shell'
import { useAuth } from '@/contexts/auth'
import { AuthGate } from '@/routes/auth-gate'
import { DownloadsPage } from '@/routes/downloads'
import { IndexersPage } from '@/routes/indexers'
import { LibraryPage } from '@/routes/library'
import { MediaDetailPage } from '@/routes/media-detail'
import { MediaSeasonDetailPage } from '@/routes/media-season-detail'
import { MediaSourcesPage } from '@/routes/media-sources'
import { MediaWorkspace } from '@/routes/media-workspace'
import { PersonCreditsPage } from '@/routes/person-credits'
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
            path: 'series/:id',
            element: <MediaDetailPage kind="tv" />,
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
            element: <LibraryPage />,
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
