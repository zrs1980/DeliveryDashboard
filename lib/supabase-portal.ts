import { createClient } from "@supabase/supabase-js";

// Client-side Supabase for portal pages (browser session via localStorage)
// Uses NEXT_PUBLIC_ vars so they're available in browser bundles
export function getSupabasePortalClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// Server-side portal client — applies RLS via the customer's Supabase JWT
// Pass the access_token from the Authorization header of the incoming request
export function getSupabasePortalServer(accessToken: string) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${accessToken}` } } },
  );
}

export interface PortalUser {
  id: string;
  customer_ns_id: string;
  customer_name: string;
  email: string;
  display_name: string | null;
}

// Resolve the portal user from an access token; returns null if unauthenticated
export async function resolvePortalUser(accessToken: string): Promise<PortalUser | null> {
  const db = getSupabasePortalServer(accessToken);
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from("customer_portal_users").select("*").eq("id", user.id).single();
  return data ?? null;
}
