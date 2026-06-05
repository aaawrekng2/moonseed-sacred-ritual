revoke execute on function public.ai_effective_gate(uuid) from public, anon;
grant execute on function public.ai_effective_gate(uuid) to authenticated, service_role;