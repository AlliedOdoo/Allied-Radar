import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowserConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !publishableKey) {
    throw new Error("Supabase browser configuration is incomplete.");
  }

  return { url, publishableKey };
}

export function getSupabaseBrowserClient() {
  const { url, publishableKey } = getSupabaseBrowserConfig();
  if (!browserClient) {
    browserClient = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  }
  return browserClient;
}

export const MICROSOFT_GRAPH_SCOPES = [
  "email",
  "openid",
  "profile",
  "offline_access",
  "Mail.Read",
  "Mail.Send",
  "Chat.Read",
  "ChatMessage.Send",
].join(" ");

export const MICROSOFT_GRAPH_READ_SCOPES = [
  "email",
  "openid",
  "profile",
  "offline_access",
  "Mail.Read",
  "Chat.Read",
].join(" ");
