import { createStart } from "@tanstack/react-start";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

/**
 * Registers the Supabase auth-attacher as a global function middleware.
 * Without this, browser-side server function calls to /_serverFn/*
 * never include the Bearer token, and the server middleware rejects
 * every request with 401 Unauthorized.
 *
 * Auto-discovered by the TanStack Start Vite plugin at src/start.ts.
 */
export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
}));