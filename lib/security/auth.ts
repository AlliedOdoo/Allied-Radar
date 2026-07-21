import { requireSupabaseAnonKey, requireSupabaseUrl } from "./config";
import { ApiError } from "./errors";

export type SupabaseUser = {
  id: string;
  email?: string;
  role?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

export type AuthenticatedRequest = {
  user: SupabaseUser;
  accessToken: string;
};

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token, extra] = authorization.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) {
    throw new ApiError("unauthorized", "Authentication required.", 401);
  }
  return token;
}

export async function requireSupabaseUser(request: Request): Promise<AuthenticatedRequest> {
  const accessToken = bearerToken(request);
  const authUrl = `${requireSupabaseUrl()}/auth/v1/user`;

  let response: Response;
  try {
    response = await fetch(authUrl, {
      method: "GET",
      headers: {
        apikey: requireSupabaseAnonKey(),
        authorization: `Bearer ${accessToken}`,
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiError("auth_unavailable", "Authentication service is unavailable.", 503);
  }

  if (!response.ok) {
    throw new ApiError("unauthorized", "Authentication required.", 401);
  }

  const payload = (await response.json().catch(() => null)) as SupabaseUser | null;
  if (!payload?.id) {
    throw new ApiError("unauthorized", "Authentication required.", 401);
  }

  return { user: payload, accessToken };
}
