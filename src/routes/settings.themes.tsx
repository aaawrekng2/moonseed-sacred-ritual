import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/themes')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/settings/themes"!</div>
}
