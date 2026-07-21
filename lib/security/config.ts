import { ConfigurationError } from "./errors";

export function requireEnv(name: string, minLength = 1) {
  const value = process.env[name]?.trim();
  if (!value || value.length < minLength) {
    throw new ConfigurationError();
  }
  return value;
}

export function requireSupabaseUrl() {
  const value =
    process.env.SUPABASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!value) throw new ConfigurationError();
  try {
    return new URL(value).origin;
  } catch {
    throw new ConfigurationError();
  }
}

export function requireSupabaseAnonKey() {
  const value =
    process.env.SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!value || value.length < 20) throw new ConfigurationError();
  return value;
}

export function requireSupabaseServiceRoleKey() {
  return requireEnv("SUPABASE_SERVICE_ROLE_KEY", 20);
}
