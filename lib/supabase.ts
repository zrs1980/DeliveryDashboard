import { createClient } from "@supabase/supabase-js";

// Returns a service-role Supabase client. Called at request time (not module-load time)
// so the env vars don't need to be present during `next build`.
export function getSupabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
