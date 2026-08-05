import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { server } from '@/test/msw'
import { AuthGate } from './auth-gate'

describe('AuthGate session failures', () => {
  it.each([
    ['an upstream failure', () => new HttpResponse(null, { status: 503 })],
    ['an invalid session representation', () => HttpResponse.json({ user: { id: 'partial' } })],
  ])('does not misclassify %s as a signed-out user', async (_name, response) => {
    server.use(http.get('/auth/session', response))
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route element={<AuthGate />}>
              <Route index element={<p>Authenticated content</p>} />
            </Route>
            <Route path="/login" element={<p>Login route</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Session unavailable')
    expect(screen.queryByText('Login route')).not.toBeInTheDocument()
  })
})
