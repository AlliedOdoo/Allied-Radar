"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "../../lib/supabase/browser";

type ProviderName = "Outlook" | "Teams" | "Odoo Discuss" | "WhatsApp";

type ProviderStatus = {
  provider: ProviderName;
  configured: boolean;
  delivery: "api" | "handoff";
  detail: string;
};

type StatusResponse = {
  sendEnabled: boolean;
  confirmationReady: boolean;
  providers: ProviderStatus[];
};

type SendComposerProps = {
  provider: ProviderName;
  destination: string;
  destinationLabel: string;
  draftKey?: string;
  subject?: string;
  replyToId?: string;
  replyMode?: "reply" | "reply_all";
  cc?: string[];
  bcc?: string[];
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  initialContent: string;
  sourceMessage?: string;
  context?: string;
  aiActions?: string[];
  compact?: boolean;
};

type SendResponse = {
  ok: boolean;
  detail?: string;
  error?: string;
  state?: "accepted" | "sent" | "handoff";
  handoffUrl?: string;
  handoffId?: string;
  pushQueued?: boolean;
};

type ComposerAttachment = {
  name: string;
  contentType: string;
  contentBytes: string;
  size: number;
};

type ContactSuggestion = {
  name: string;
  address?: string;
  phone?: string;
  source: string;
};

async function sessionAuthorization() {
  try {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    return data.session ? `Bearer ${data.session.access_token}` : null;
  } catch {
    return null;
  }
}

function parseAddressList(value: string) {
  return value
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseHeaderList(value: string) {
  return value
    .split("\n")
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator < 0) return null;
      const name = line.slice(0, separator).trim();
      const headerValue = line.slice(separator + 1).trim();
      return name || headerValue ? { name, value: headerValue } : null;
    })
    .filter((item): item is { name: string; value: string } => Boolean(item));
}

export function SendComposer({
  provider,
  destination,
  destinationLabel,
  draftKey,
  subject,
  replyToId,
  replyMode,
  cc,
  bcc,
  internetMessageHeaders,
  initialContent,
  sourceMessage,
  context,
  aiActions = [],
  compact = false,
}: SendComposerProps) {
  const [content, setContent] = useState(initialContent);
  const [destinationValue, setDestinationValue] = useState(destination);
  const [ccValue, setCcValue] = useState((cc || []).join(", "));
  const [bccValue, setBccValue] = useState((bcc || []).join(", "));
  const [headerValue, setHeaderValue] = useState(
    (internetMessageHeaders || []).map((header) => `${header.name}: ${header.value}`).join("\n"),
  );
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [contacts, setContacts] = useState<ContactSuggestion[]>([]);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);

  const providerStatus = useMemo(
    () => status?.providers.find((item) => item.provider === provider),
    [provider, status],
  );
  const canEditDestination = provider === "Outlook" && !replyToId;
  const canEditCcBcc = provider === "Outlook";
  const canEditHeaders = provider === "Outlook" && !replyToId;
  const effectiveDestination = canEditDestination ? destinationValue.trim() : destination;
  const effectiveCc = canEditCcBcc ? parseAddressList(ccValue) : cc;
  const effectiveBcc = canEditCcBcc ? parseAddressList(bccValue) : bcc;
  const effectiveHeaders = canEditHeaders ? parseHeaderList(headerValue) : internetMessageHeaders;
  const effectiveAttachments = provider === "Outlook" && !replyToId ? attachments : undefined;
  const effectiveDestinationLabel = canEditDestination ? effectiveDestination || destinationLabel : destinationLabel;
  const canReview = Boolean(content.trim()) && Boolean(effectiveDestination.trim()) && !sending;

  useEffect(() => {
    setContent(initialContent);
    setDestinationValue(destination);
    setCcValue((cc || []).join(", "));
    setBccValue((bcc || []).join(", "));
    setHeaderValue((internetMessageHeaders || []).map((header) => `${header.name}: ${header.value}`).join("\n"));
  }, [bcc, cc, destination, initialContent, internetMessageHeaders]);

  useEffect(() => {
    let active = true;
    async function loadDraft() {
      if (!draftKey) return;
      const authorization = await sessionAuthorization();
      if (!authorization) return;
      const params = new URLSearchParams({
        provider,
        threadKey: draftKey,
        replyMode: replyMode ?? "new",
      });
      const response = await fetch(`/api/drafts?${params}`, {
        cache: "no-store",
        headers: { Authorization: authorization },
      });
      const payload = (await response.json().catch(() => ({}))) as { draft?: { content?: string; destination?: string | null; subject?: string | null; updated_at?: string } | null };
      if (!active || !response.ok || !payload.draft?.content) return;
      setContent(payload.draft.content);
      if (payload.draft.destination && !replyToId) setDestinationValue(payload.draft.destination);
      setDraftSavedAt(payload.draft.updated_at ?? null);
    }
    void loadDraft();
    return () => {
      active = false;
    };
  }, [draftKey, provider, replyMode, replyToId]);

  useEffect(() => {
    if (!draftKey) return;
    const handle = window.setTimeout(async () => {
      const authorization = await sessionAuthorization();
      if (!authorization) return;
      const response = await fetch("/api/drafts", {
        method: "PUT",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          provider,
          threadKey: draftKey,
          replyMode: replyMode ?? "new",
          destination: effectiveDestination,
          subject,
          content,
          metadata: {
            cc: effectiveCc ?? [],
            bcc: effectiveBcc ?? [],
            headers: effectiveHeaders ?? [],
            hasAttachments: Boolean(effectiveAttachments?.length),
          },
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { draft?: { updated_at?: string } };
      if (response.ok) setDraftSavedAt(payload.draft?.updated_at ?? new Date().toISOString());
    }, 900);
    return () => window.clearTimeout(handle);
  }, [content, draftKey, effectiveBcc, effectiveCc, effectiveDestination, effectiveHeaders, effectiveAttachments, provider, replyMode, subject]);

  useEffect(() => {
    if (!canEditDestination) return;
    const query = destinationValue.trim();
    if (query.length < 2) {
      setContacts([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      const authorization = await sessionAuthorization();
      if (!authorization) return;
      const response = await fetch(`/api/contacts/search?query=${encodeURIComponent(query)}`, {
        cache: "no-store",
        headers: { Authorization: authorization },
      });
      const payload = (await response.json().catch(() => ({}))) as { contacts?: ContactSuggestion[] };
      if (response.ok) setContacts(payload.contacts ?? []);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [canEditDestination, destinationValue]);

  useEffect(() => {
    let active = true;
    sessionAuthorization()
      .then((authorization) =>
        fetch("/api/messages/providers", {
          cache: "no-store",
          headers: authorization ? { Authorization: authorization } : undefined,
        }),
      )
      .then((response) => response.json() as Promise<StatusResponse>)
      .then((payload) => {
        if (active) setStatus(payload);
      })
      .catch(() => {
        if (active) {
          setStatus({
            sendEnabled: false,
            confirmationReady: false,
            providers: [],
          });
          setFeedback({
            tone: "error",
            text: "Connector status is unavailable. Sending remains paused.",
          });
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function addAttachments(fileList: FileList | null) {
    if (!fileList?.length) return;
    const files = Array.from(fileList);
    const existingSize = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
    const newSize = files.reduce((sum, file) => sum + file.size, 0);
    if (attachments.length + files.length > 5 || existingSize + newSize > 10 * 1024 * 1024) {
      setFeedback({ tone: "error", text: "Attach up to 5 files, 10 MB total for now." });
      return;
    }
    const encoded = await Promise.all(
      files.map(
        (file) =>
          new Promise<ComposerAttachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error("Could not read attachment."));
            reader.onload = () => {
              const result = String(reader.result || "");
              resolve({
                name: file.name,
                contentType: file.type || "application/octet-stream",
                contentBytes: result.split(",")[1] || "",
                size: file.size,
              });
            };
            reader.readAsDataURL(file);
          }),
      ),
    );
    setAttachments((current) => [...current, ...encoded]);
    setFeedback(null);
  }
  const readyToSend = Boolean(
    status?.sendEnabled &&
      status.confirmationReady &&
      providerStatus?.configured,
  );

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(content);
      setFeedback({ tone: "success", text: "Draft copied." });
    } catch {
      setFeedback({
        tone: "error",
        text: "Copy was blocked by the browser. Select the text and copy it manually.",
      });
    }
  }

  async function rewriteDraft(instruction: string) {
    if (drafting) return;
    setDrafting(true);
    setFeedback(null);
    try {
      const authorization = await sessionAuthorization();
      if (!authorization) {
        throw new Error("Connect Microsoft 365 before using private AI drafting.");
      }
      const tone = instruction.toLowerCase().includes("firm")
        ? "firm"
        : instruction.toLowerCase().includes("short")
          ? "short"
          : instruction.toLowerCase().includes("warm")
            ? "warm"
            : "detailed";
      const response = await fetch("/api/ai/draft", {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: sourceMessage || content,
          tone,
          instruction,
          context: [context, `Current editable draft: ${content}`]
            .filter(Boolean)
            .join("\n"),
        }),
      });
      const payload = (await response.json()) as { draft?: string; error?: string };
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error || "The AI draft could not be updated.");
      }
      setContent(payload.draft);
      setFeedback({
        tone: "success",
        text: "Draft updated. Review every word before sending.",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "The AI draft could not be updated.",
      });
    } finally {
      setDrafting(false);
    }
  }

  async function confirmSend() {
    if (!reviewed || !readyToSend || sending) return;

    setSending(true);
    setFeedback(null);
    try {
      const authorization = await sessionAuthorization();
      if (!authorization) {
        throw new Error("Connect Microsoft 365 before preparing a send.");
      }
      const confirmedMessage = {
        provider,
        destination: effectiveDestination,
        destinationLabel: effectiveDestinationLabel,
        subject,
        replyToId,
        replyMode,
        cc: effectiveCc,
        bcc: effectiveBcc,
        internetMessageHeaders: effectiveHeaders,
        attachments: effectiveAttachments,
        content,
        clientRequestId: crypto.randomUUID(),
        confirmation: {
          action: "send_now",
          recipient: effectiveDestinationLabel,
          reviewed: true,
        },
      };
      const reviewResponse = await fetch("/api/messages/confirm", {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          "X-Allied-User-Intent": "review-message",
        },
        body: JSON.stringify(confirmedMessage),
      });
      const reviewPayload = (await reviewResponse.json()) as {
        token?: string;
        error?: string;
      };
      if (!reviewResponse.ok || !reviewPayload.token) {
        throw new Error(
          reviewPayload.error || "The final review could not be confirmed.",
        );
      }

      const response = await fetch("/api/messages/send", {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          "X-Allied-User-Intent": "confirm-send",
        },
        body: JSON.stringify({
          ...confirmedMessage,
          confirmationToken: reviewPayload.token,
        }),
      });
      const payload = (await response.json()) as SendResponse;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || "The provider rejected the message.");
      }

      setReviewing(false);
      setReviewed(false);
      if (payload.state === "handoff" && payload.handoffUrl) {
        if (payload.pushQueued) {
          setFeedback({
            tone: "success",
            text: payload.detail || "Message sent to your phone for final WhatsApp confirmation.",
          });
          return;
        }
        window.location.assign(payload.handoffUrl);
        return;
      }
      setFeedback({
        tone: "success",
        text:
          payload.detail ||
          (payload.state === "accepted"
            ? `${provider} accepted the message for delivery.`
            : `Sent in ${provider}.`),
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        text:
          error instanceof Error
            ? `${error.message} Nothing was retried automatically.`
            : "Send failed. Nothing was retried automatically.",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={compact ? "send-composer compact" : "send-composer"}>
      {!compact && (
        <div className="section-heading">
          <span>Message composer</span>
          <small>AI draft / human send</small>
        </div>
      )}

      {canEditDestination ? (
        <div className="composer-address-grid">
          <label className="compose-input inline-compose-input">
            <span>To</span>
            <input
              list={`contacts-${draftKey || provider}`}
              value={destinationValue}
              onChange={(event) => {
                setDestinationValue(event.target.value);
                setFeedback(null);
              }}
              placeholder="name@company.com"
              inputMode="email"
            />
            <datalist id={`contacts-${draftKey || provider}`}>
              {contacts.map((contact) => {
                const value = contact.address || contact.phone || contact.name;
                return <option key={`${contact.source}-${value}`} value={value}>{contact.name} · {contact.source}</option>;
              })}
            </datalist>
          </label>
        </div>
      ) : (
        <label className="composer-field">
          <span>To</span>
          <strong>{destinationLabel}</strong>
          <small>{provider === "Outlook" && replyMode === "reply_all" ? "Reply all" : provider}</small>
        </label>
      )}

      {canEditCcBcc && (
        <div className="composer-address-grid">
          <button className="composer-details-toggle" type="button" onClick={() => setDetailsOpen((open) => !open)}>
            {detailsOpen ? "Hide Cc/Bcc" : "Cc/Bcc"}
          </button>
          {detailsOpen && (
            <>
              <label className="compose-input inline-compose-input">
                <span>Cc</span>
                <input
                  value={ccValue}
                  onChange={(event) => {
                    setCcValue(event.target.value);
                    setFeedback(null);
                  }}
                  placeholder="cc@example.com, another@example.com"
                  inputMode="email"
                />
              </label>
              <label className="compose-input inline-compose-input">
                <span>Bcc</span>
                <input
                  value={bccValue}
                  onChange={(event) => {
                    setBccValue(event.target.value);
                    setFeedback(null);
                  }}
                  placeholder="bcc@example.com"
                  inputMode="email"
                />
              </label>
            </>
          )}
        </div>
      )}

      {subject && !compact && (
        <label className="composer-field">
          <span>Subject</span>
          <strong>{subject}</strong>
        </label>
      )}

      {canEditHeaders && detailsOpen && (
        <label className="compose-input inline-compose-input">
          <span>Email headers</span>
          <textarea
            value={headerValue}
            onChange={(event) => {
              setHeaderValue(event.target.value);
              setFeedback(null);
            }}
            placeholder={"x-project-id: SO00052\nx-radar-source: allied-radar"}
          />
        </label>
      )}

      {provider === "Outlook" && !replyToId && (
        <div className="attachment-picker">
          <label>
            <span>Attachments</span>
            <input
              type="file"
              multiple
              onChange={(event) => {
                void addAttachments(event.target.files);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {attachments.length > 0 && (
            <ul>
              {attachments.map((attachment, index) => (
                <li key={`${attachment.name}-${index}`}>
                  <span>{attachment.name}</span>
                  <small>{Math.ceil(attachment.size / 1024)} KB</small>
                  <button
                    type="button"
                    onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <textarea
        aria-label={`Message to ${destinationLabel}`}
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          setFeedback(null);
        }}
      />

      {aiActions.length > 0 && (
        <div className="draft-actions" aria-label="AI draft tools">
          {aiActions.map((action) => (
            <button
              disabled={drafting || sending}
              key={action}
              onClick={() => rewriteDraft(action)}
              type="button"
            >
              {drafting ? "Working…" : action}
            </button>
          ))}
        </div>
      )}

      <div className="connector-state" data-ready={readyToSend}>
        <span className="connector-dot" />
        <span>
          {!status
            ? "Checking connector..."
            : !providerStatus?.configured
              ? `${provider} needs to be connected before sending.`
              : !status.sendEnabled
                ? "Connector ready. Sending is paused by the master switch."
                : !status.confirmationReady
                  ? "Connector ready. The secure confirmation secret is missing."
                  : providerStatus.delivery === "handoff"
                    ? "WhatsApp handoff ready. You will press Send in WhatsApp."
                    : `${provider} connected. A final confirmation is required.`}
        </span>
      </div>

      {draftKey && draftSavedAt && (
        <p className="draft-save-state">Draft saved {new Date(draftSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
      )}

      <div className="composer-actions">
        <button className="secondary-action" type="button" onClick={copyDraft}>
          Copy draft
        </button>
        <button
          className="send-review-action"
          type="button"
          disabled={!canReview}
          onClick={() => {
            setReviewed(false);
            setReviewing(true);
            setFeedback(null);
          }}
        >
          Review &amp; send
        </button>
      </div>

      <p className="send-boundary">
        AI can edit this draft, but cannot press send. Delivery only starts
        after your confirmation.
      </p>

      {feedback && (
        <p className={`send-feedback ${feedback.tone}`} role="status">
          {feedback.text}
        </p>
      )}

      {reviewing && (
        <div
          className="confirmation-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !sending) {
              setReviewing(false);
            }
          }}
        >
          <section
            aria-labelledby="confirm-send-title"
            aria-modal="true"
            className="confirmation-dialog"
            role="dialog"
          >
            <div className="confirmation-heading">
              <div>
                <p className="eyebrow">Final review</p>
                <h3 id="confirm-send-title">Send to {effectiveDestinationLabel}?</h3>
              </div>
              <button
                aria-label="Close send review"
                className="dialog-close"
                disabled={sending}
                onClick={() => setReviewing(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <dl className="send-review-grid">
              <div>
                <dt>Source</dt>
                <dd>{provider}</dd>
              </div>
              <div>
                <dt>Recipient</dt>
                <dd>{effectiveDestinationLabel}</dd>
              </div>
              {subject && (
                <div>
                  <dt>Subject</dt>
                  <dd>{subject}</dd>
                </div>
              )}
              {effectiveCc?.length ? (
                <div>
                  <dt>CC</dt>
                  <dd>{effectiveCc.join(", ")}</dd>
                </div>
              ) : null}
              {effectiveBcc?.length ? (
                <div>
                  <dt>BCC</dt>
                  <dd>{effectiveBcc.join(", ")}</dd>
                </div>
              ) : null}
              {effectiveHeaders?.length ? (
                <div>
                  <dt>Headers</dt>
                  <dd>{effectiveHeaders.map((header) => `${header.name}: ${header.value}`).join("; ")}</dd>
                </div>
              ) : null}
              {effectiveAttachments?.length ? (
                <div>
                  <dt>Attachments</dt>
                  <dd>
                    {effectiveAttachments
                      .map((attachment) => `${attachment.name} (${Math.ceil(attachment.size / 1024)} KB)`)
                      .join(", ")}
                  </dd>
                </div>
              ) : null}
            </dl>

            <div className="send-preview">{content}</div>

            <label className="review-check">
              <input
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
                type="checkbox"
              />
              <span>I checked the recipients and the full message.</span>
            </label>

            {!readyToSend && (
              <p className="send-feedback error" role="status">
                {!providerStatus?.configured
                  ? `${provider} is not connected for sending yet.`
                  : !status?.sendEnabled
                    ? "Sending is paused in server settings."
                    : "The secure confirmation service is not configured."}
              </p>
            )}

            <div className="dialog-actions">
              <button
                className="secondary-action"
                disabled={sending}
                onClick={() => setReviewing(false)}
                type="button"
              >
                Keep editing
              </button>
              <button
                className="send-now-action"
                disabled={!reviewed || !readyToSend || sending}
                onClick={confirmSend}
                type="button"
              >
                {sending
                  ? "Preparing..."
                  : provider === "WhatsApp"
                    ? "Open WhatsApp to send"
                    : `Send now in ${provider}`}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
