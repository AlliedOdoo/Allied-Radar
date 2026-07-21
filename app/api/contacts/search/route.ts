import { requireSupabaseUser } from "../../../../lib/security/auth";
import { apiErrorResponse, noStoreJson } from "../../../../lib/security/http";
import { postgrestValue, supabaseRest } from "../../../../lib/supabase/rest";

export const dynamic = "force-dynamic";

type ContactRow = {
  sender: { name?: string; address?: string; phone?: string } | null;
  recipients: Array<{ name?: string; address?: string; phone?: string }> | null;
  source: string;
};

export async function GET(request: Request) {
  try {
    const { user, accessToken } = await requireSupabaseUser(request);
    const url = new URL(request.url);
    const query = url.searchParams.get("query")?.trim().toLowerCase() ?? "";
    const rows = await supabaseRest<ContactRow[]>(
      `/rest/v1/messages?user_id=eq.${postgrestValue(user.id)}&select=sender,recipients,source&order=received_at.desc.nullslast,created_at.desc&limit=300`,
      { method: "GET" },
      { accessToken },
    );
    const seen = new Set<string>();
    const contacts = rows
      .flatMap((row) => [row.sender, ...(Array.isArray(row.recipients) ? row.recipients : [])].map((person) => ({ person, source: row.source })))
      .filter(({ person }) => person && (person.address || person.phone || person.name))
      .map(({ person, source }) => ({
        name: person?.name ?? person?.address ?? person?.phone ?? "",
        address: person?.address ?? "",
        phone: person?.phone ?? "",
        source,
      }))
      .filter((contact) => {
        const key = (contact.address || contact.phone || contact.name).toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        if (!query) return true;
        return [contact.name, contact.address, contact.phone, contact.source].join(" ").toLowerCase().includes(query);
      })
      .slice(0, 12);
    return noStoreJson({ ok: true, contacts });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
