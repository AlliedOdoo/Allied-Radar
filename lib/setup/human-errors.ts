const knownErrorMessages: Array<[RegExp, string]> = [
  [
    /AADSTS500113/i,
    "Microsoft sign-in is not ready because the redirect URL is missing. Ask an admin to add the callback URL shown in setup.",
  ],
  [
    /AADSTS90002/i,
    "The Microsoft tenant ID looks wrong. Ask an admin to check the Allied Fibreglass Entra tenant setting.",
  ],
  [
    /odoo.*auth|odoo_auth_failed|authentication failed/i,
    "Odoo rejected the saved integration login. Ask an admin to update the Odoo API key.",
  ],
  [
    /supabase_rest_error|database request failed/i,
    "The private database could not be reached. Nothing was synced or sent.",
  ],
  [
    /provider_not_connected|needs to be reconnected/i,
    "This account connection has expired. Reconnect it before syncing or sending.",
  ],
];

export function humanSetupError(message?: string | null) {
  if (!message) return null;
  const known = knownErrorMessages.find(([pattern]) => pattern.test(message));
  return known?.[1] ?? message;
}
