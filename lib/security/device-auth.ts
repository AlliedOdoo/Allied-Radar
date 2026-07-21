import { ApiError } from "./errors";
import { hashDeviceToken } from "./hash";
import { postgrestValue, supabaseRest } from "../supabase/rest";

export type AuthenticatedDevice = {
  id: string;
  user_id: string;
  platform: string;
  installation_id: string | null;
  push_provider: string | null;
  push_token_vault: Record<string, unknown> | null;
};

export function deviceBearer(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token, extra] = authorization.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra) {
    throw new ApiError("device_auth_required", "Device authentication failed.", 401);
  }
  return token;
}

export async function requireDevice(request: Request) {
  const token = deviceBearer(request);
  const tokenHash = await hashDeviceToken(token);
  const rows = await supabaseRest<AuthenticatedDevice[]>(
    `/rest/v1/devices?device_token_hash=eq.${postgrestValue(tokenHash)}&is_active=eq.true&select=id,user_id,platform,installation_id,push_provider,push_token_vault&limit=1`,
    { method: "GET" },
    { serviceRole: true },
  );
  const device = rows[0];
  if (!device) {
    throw new ApiError("device_auth_failed", "Device authentication failed.", 401);
  }
  return { device, token };
}

export function randomBearerToken(bytes = 48) {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
