import { LogOut, Settings, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar, AvatarBadge, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SidebarMenuButton } from '@/components/ui/sidebar'
import { isAdminUser, useAuth } from '@/contexts/auth'
import { getTmdbLanguage, supportedLanguages } from '@/i18n'
import { authClient } from '@/lib/auth-client'

export function UserPanel() {
  const { i18n, t } = useTranslation()
  const { refreshSession, user } = useAuth()
  const currentLanguage = getTmdbLanguage(i18n.language)
  const currentLanguageLabel =
    supportedLanguages.find((language) => language.value === currentLanguage)?.label ?? currentLanguage

  async function handleLanguageChange(language: string) {
    window.localStorage.setItem('zme.language', language)
    await i18n.changeLanguage(language)
  }

  async function handleSignOut() {
    await authClient.signOut()
    await refreshSession()
  }

  const initials =
    user.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('')
      .slice(0, 2) ||
    user.email[0]?.toUpperCase() ||
    'U'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <SidebarMenuButton
            size="lg"
            className="h-auto min-h-14 rounded-xl px-3 py-2 text-sidebar-foreground hover:bg-sidebar-accent"
          />
        }
      >
        <Avatar size="lg" className="rounded-lg">
          <AvatarFallback className="rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-semibold">
            {initials}
          </AvatarFallback>
          <AvatarBadge className="bg-emerald-400" />
        </Avatar>
        <span className="min-w-0 flex-1 text-left">
          <span className="block truncate font-medium text-sm">{user.name}</span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-muted-foreground text-xs">
            <ShieldCheck className="size-3.5 shrink-0 text-emerald-300" />
            {t('signedIn')}
          </span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={8}
        className="dark w-56 border border-sidebar-border bg-sidebar text-sidebar-foreground"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
          <DropdownMenuItem>
            <ShieldCheck />
            <span>{isAdminUser(user) ? t('administrator') : t('standardUser')}</span>
            <span className="ml-auto size-2 rounded-full bg-emerald-500" aria-hidden />
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Settings />
              <span>{t('language')}</span>
              <span className="ml-auto text-muted-foreground text-xs">{currentLanguageLabel}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="dark border border-sidebar-border bg-sidebar text-sidebar-foreground">
              <DropdownMenuRadioGroup
                value={currentLanguage}
                onValueChange={(value) => void handleLanguageChange(value)}
              >
                {supportedLanguages.map((language) => (
                  <DropdownMenuRadioItem key={language.value} value={language.value}>
                    {language.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={() => void handleSignOut()}>
            <LogOut />
            <span>{t('signOut')}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
