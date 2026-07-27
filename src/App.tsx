import { QueryClientProvider } from '@tanstack/react-query'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import relativeTime from 'dayjs/plugin/relativeTime'
import { RouterProvider } from 'react-router'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { queryClient } from '@/lib/query-client'
import { router } from '@/routes/router'

dayjs.extend(relativeTime)

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster richColors />
        <Toaster
          id="release-search"
          position="top-right"
          offset={{ top: '5rem', right: '1.5rem' }}
          mobileOffset={{ top: '8rem', right: '1rem', left: '1rem' }}
          richColors
          containerAriaLabel="Search notifications"
        />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
