import { noStoreJson } from "../../../../lib/security/http";

export const dynamic = "force-dynamic";

export async function POST() {
  return noStoreJson(
    {
      ok: false,
      code: "confirmed_send_required",
      error: "WhatsApp handoffs can only be created by the confirmed send endpoint.",
    },
    { status: 405 },
  );
}
