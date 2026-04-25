import { createFileRoute } from '@tanstack/react-router'
import { DataTab } from '@/components/settings/DataTab'

export const Route = createFileRoute('/settings/data')({
  component: DataTab,
})
