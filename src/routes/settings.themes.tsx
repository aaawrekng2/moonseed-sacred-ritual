import { createFileRoute } from '@tanstack/react-router'
import { ThemesTab } from '@/components/settings/ThemesTab'

export const Route = createFileRoute('/settings/themes')({
  component: ThemesTab,
})
