import {
  MESSAGE_PROVIDERS,
  MessagingError,
  type ConfirmedSendRequest,
  type MessageProvider,
} from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const HEADER_NAME_PATTERN = /^x-[a-z0-9][a-z0-9-]{0,78}$/i;
const MAX_ATTACHMENT_TOTAL_BYTES = 10 * 1024 * 1024;

function textField(
  value: unknown,
  name: string,
  options: { max: number; required?: boolean },
) {
  if (typeof value !== "string") {
    if (!options.required && value === undefined) return undefined;
    throw new MessagingError("invalid_request", `${name} must be text`);
  }

  const trimmed = value.trim();
  if (options.required && !trimmed) {
    throw new MessagingError("invalid_request", `${name} is required`);
  }
  if (trimmed.length > options.max) {
    throw new MessagingError(
      "invalid_request",
      `${name} must be ${options.max} characters or fewer`,
    );
  }

  return trimmed;
}

function emailListField(value: unknown, name: string) {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[;,\n]/)
      : null;
  if (!raw) throw new MessagingError("invalid_request", `${name} must be a list of email addresses`);
  const emails = raw
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  for (const email of emails) {
    if (email.length > 320 || !EMAIL_PATTERN.test(email)) {
      throw new MessagingError("invalid_request", `${name} contains an invalid email address`);
    }
  }
  return [...new Set(emails)];
}

function headerListField(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new MessagingError("invalid_request", "internetMessageHeaders must be a list");
  }
  const headers = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Record<string, unknown>;
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      const headerValue = typeof candidate.value === "string" ? candidate.value.trim() : "";
      return name || headerValue ? { name, value: headerValue } : null;
    })
    .filter((item): item is { name: string; value: string } => Boolean(item));

  if (headers.length > 10) {
    throw new MessagingError("invalid_request", "Use 10 custom headers or fewer");
  }
  for (const header of headers) {
    if (!HEADER_NAME_PATTERN.test(header.name)) {
      throw new MessagingError("invalid_request", "Custom email header names must start with x-");
    }
    if (!header.value || header.value.length > 998 || /[\r\n]/.test(header.value)) {
      throw new MessagingError("invalid_request", "Custom email header values must be single-line text");
    }
  }
  return headers;
}

function attachmentListField(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new MessagingError("invalid_request", "attachments must be a list");
  }
  if (value.length > 5) {
    throw new MessagingError("invalid_request", "Attach 5 files or fewer");
  }
  const attachments = value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new MessagingError("invalid_request", "Each attachment must be an object");
    }
    const candidate = item as Record<string, unknown>;
    const name = textField(candidate.name, "attachment.name", { max: 180, required: true })!;
    const contentType = textField(candidate.contentType, "attachment.contentType", { max: 120 }) || "application/octet-stream";
    const contentBytes = textField(candidate.contentBytes, "attachment.contentBytes", { max: 15_000_000, required: true })!;
    const size = typeof candidate.size === "number" && Number.isFinite(candidate.size) ? candidate.size : 0;
    if (size <= 0 || size > MAX_ATTACHMENT_TOTAL_BYTES) {
      throw new MessagingError("invalid_request", "Each attachment must be 10 MB or smaller");
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(contentBytes)) {
      throw new MessagingError("invalid_request", "Attachment content must be base64");
    }
    return { name, contentType, contentBytes, size };
  });
  const total = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
  if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
    throw new MessagingError("invalid_request", "Attachments must total 10 MB or less");
  }
  return attachments;
}

export function parseConfirmedSendRequest(input: unknown): ConfirmedSendRequest {
  if (!input || typeof input !== "object") {
    throw new MessagingError("invalid_request", "A message body is required");
  }

  const candidate = input as Record<string, unknown>;
  const provider = candidate.provider;
  if (
    typeof provider !== "string" ||
    !MESSAGE_PROVIDERS.includes(provider as MessageProvider)
  ) {
    throw new MessagingError("invalid_provider", "Select a supported source");
  }

  const destination = textField(candidate.destination, "destination", {
    max: 512,
    required: true,
  })!;
  const destinationLabel = textField(
    candidate.destinationLabel,
    "destinationLabel",
    { max: 160, required: true },
  )!;
  const content = textField(candidate.content, "content", {
    max: 20_000,
    required: true,
  })!;
  const subject = textField(candidate.subject, "subject", { max: 998 });
  const replyToId = textField(candidate.replyToId, "replyToId", { max: 512 });
  const replyModeValue = textField(candidate.replyMode, "replyMode", { max: 16 });
  const replyMode = replyModeValue === "reply_all" ? "reply_all" : replyModeValue === "reply" ? "reply" : undefined;
  if (replyModeValue && !replyMode) {
    throw new MessagingError("invalid_request", "replyMode must be reply or reply_all");
  }
  const cc = emailListField(candidate.cc, "cc");
  const bcc = emailListField(candidate.bcc, "bcc");
  const internetMessageHeaders = headerListField(candidate.internetMessageHeaders);
  const attachments = attachmentListField(candidate.attachments);
  const clientRequestId = textField(
    candidate.clientRequestId,
    "clientRequestId",
    { max: 64, required: true },
  )!;
  const confirmationToken = textField(
    candidate.confirmationToken,
    "confirmationToken",
    { max: 4096 },
  );

  if (!UUID_PATTERN.test(clientRequestId)) {
    throw new MessagingError(
      "invalid_request_id",
      "clientRequestId must be a UUID",
    );
  }
  if (1 + (cc?.length ?? 0) + (bcc?.length ?? 0) > 500) {
    throw new MessagingError("invalid_request", "Outlook supports up to 500 total recipients");
  }
  if ((cc?.length || bcc?.length || internetMessageHeaders?.length || attachments?.length) && provider !== "Outlook") {
    throw new MessagingError("invalid_request", "CC, BCC, headers, and attachments are only supported for Outlook email");
  }
  if (replyToId && internetMessageHeaders?.length) {
    throw new MessagingError("invalid_request", "Custom headers can only be added to new Outlook emails");
  }
  if (replyToId && attachments?.length) {
    throw new MessagingError("invalid_request", "Attachments are currently supported for new Outlook emails only");
  }
  if (replyMode === "reply_all" && (provider !== "Outlook" || !replyToId)) {
    throw new MessagingError("invalid_request", "Reply all is only supported for Outlook thread replies");
  }

  const confirmation = candidate.confirmation;
  if (!confirmation || typeof confirmation !== "object") {
    throw new MessagingError(
      "confirmation_required",
      "Review and confirm the message before sending",
      409,
    );
  }

  const proof = confirmation as Record<string, unknown>;
  if (
    proof.reviewed !== true ||
    proof.action !== "send_now" ||
    proof.recipient !== destinationLabel
  ) {
    throw new MessagingError(
      "confirmation_mismatch",
      "The send confirmation no longer matches this recipient",
      409,
    );
  }

  return {
    provider: provider as MessageProvider,
    destination,
    destinationLabel,
    content,
    subject,
    replyToId,
    replyMode,
    cc,
    bcc,
    internetMessageHeaders,
    attachments,
    clientRequestId,
    confirmationToken,
    confirmation: {
      action: "send_now",
      recipient: destinationLabel,
      reviewed: true,
    },
  };
}
