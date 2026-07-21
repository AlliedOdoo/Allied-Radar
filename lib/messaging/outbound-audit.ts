import { hashAuditValue } from "../security/hash";
import { postgrestValue, supabaseRest } from "../supabase/rest";
import { messageFingerprints } from "./confirmation";
import type { OutboundMessage, SendResult } from "./types";

type OutboundRow = { id: string };

export async function beginOutboundDelivery(message: OutboundMessage, userId: string) {
  const fingerprints = await messageFingerprints(message);
  const rows = await supabaseRest<OutboundRow[]>(
    "/rest/v1/outbound_deliveries",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        user_id: userId,
        client_request_id: message.clientRequestId,
        provider: message.provider,
        destination_hash: fingerprints.destinationHash,
        content_hash: fingerprints.contentHash,
        state: "authorized",
      },
    },
    { serviceRole: true },
  );
  if (!rows[0]?.id) throw new Error("Outbound audit record was not created");
  return rows[0].id;
}

export async function completeOutboundDelivery(
  id: string,
  userId: string,
  result: SendResult,
) {
  await supabaseRest<unknown>(
    `/rest/v1/outbound_deliveries?id=eq.${postgrestValue(id)}&user_id=eq.${postgrestValue(userId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: {
        state: result.state,
        provider_message_id_hash: await hashAuditValue(result.providerMessageId ?? null),
        completed_at: new Date().toISOString(),
        last_error_code: null,
      },
    },
    { serviceRole: true },
  );
}

export async function failOutboundDelivery(
  id: string,
  userId: string,
  errorCode: string,
) {
  await supabaseRest<unknown>(
    `/rest/v1/outbound_deliveries?id=eq.${postgrestValue(id)}&user_id=eq.${postgrestValue(userId)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: {
        state: "failed",
        completed_at: new Date().toISOString(),
        last_error_code: errorCode.slice(0, 100),
      },
    },
    { serviceRole: true },
  );
}
