import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/preferences')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/settings/preferences"!</div>
}
