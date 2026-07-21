"use client";

import { useEffect, useMemo, useState } from "react";
import { messages } from "../lib/mock-data";
import { AI_MODEL_LABEL } from "../lib/guardrails";
import { getSupabaseBrowserClient, MICROSOFT_GRAPH_SCOPES } from "../lib/supabase/browser";
import { ConnectionCenter } from "./components/connection-center";
import { SendComposer } from "./components/send-composer";

type MailboxFilter =
  | "All mailboxes"
  | "WhatsApp"
  | "Outlook"
  | "Teams"
  | "Odoo Discuss"
  | "Inbox"
  | "Sent"
  | "Drafts"
  | "Archive"
  | "Deleted"
  | "Junk"
  | "Outbox"
  | "Flagged"
  | "Unread";
type ProviderName = "Outlook" | "Teams" | "Odoo Discuss" | "WhatsApp";

type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

type CommandIntent = "search" | "companion";

type StoredMessage = {
  id: string;
  source: "outlook" | "teams" | "odoo_discuss" | "whatsapp" | "mobile_notification";
  external_id: string;
  external_thread_id: string | null;
  sender: { name?: string; address?: string; phone?: string } | null;
  recipients?: unknown;
  participants?: unknown;
  subject: string | null;
  preview: string | null;
  body_text: string;
  received_at: string | null;
  sent_at: string | null;
  is_read: boolean;
  is_flagged: boolean;
  mail_folder?: string | null;
  provider_state?: Record<string, unknown> | null;
  local_status?: string | null;
  opened_at?: string | null;
  acknowledged_at?: string | null;
  importance: "low" | "normal" | "high";
  ai_reason: string | null;
};

type InboxMessage = (typeof messages)[number] & {
  externalId?: string;
};

const mailboxOptions: Array<{
  label: MailboxFilter;
  icon: string;
  className: string;
}> = [
  { label: "All mailboxes", icon: "⌘", className: "all" },
  { label: "WhatsApp", icon: "◌", className: "whatsapp" },
  { label: "Outlook", icon: "✉", className: "outlook" },
  { label: "Teams", icon: "T", className: "teams" },
  { label: "Odoo Discuss", icon: "O", className: "odoo" },
];

const outlookFolderOptions: Array<{ label: MailboxFilter; folder?: string; flagged?: boolean; unread?: boolean }> = [
  { label: "Inbox", folder: "inbox" },
  { label: "Sent", folder: "sent" },
  { label: "Drafts", folder: "drafts" },
  { label: "Archive", folder: "archive" },
  { label: "Deleted", folder: "deleted" },
  { label: "Junk", folder: "junk" },
  { label: "Outbox", folder: "outbox" },
  { label: "Flagged", flagged: true },
  { label: "Unread", unread: true },
];

const sourceLabels = {
  outlook: "Outlook",
  teams: "Teams",
  odoo_discuss: "Odoo Discuss",
  whatsapp: "WhatsApp",
  mobile_notification: "WhatsApp",
} as const;

const proactiveCards = [
  {
    source: "Outlook",
    sender: "Natasha Corwin",
    body: "Email has requested a sales contract. I found the related thread where you sent the contract.",
    time: "24m",
    active: true,
  },
  {
    source: "WhatsApp",
    sender: "Luke Rankin",
    body: "Review project update for ITWA before the end of the day.",
    time: "38m",
    active: false,
  },
  {
    source: "Teams",
    sender: "Ben Munroe",
    body: "Provide spending for quarter 3. There is likely a finance follow-up needed.",
    time: "1h",
    active: false,
  },
];

function sourceClass(source: string) {
  return source.toLowerCase().replace(" discuss", "");
}

function commandIntent(value: string): CommandIntent {
  const query = value.trim().toLowerCase();
  if (!query) return "search";
  if (/[?]$/.test(query)) return "companion";
  if (/^(are|can|could|do|does|did|what|when|where|why|how|who|summari[sz]e|explain|draft|write|compose|catch|tell|help)\b/.test(query)) {
    return "companion";
  }
  if (/\b(what needs|needs reply|open loops|break ?down|recap|catch me up|priority|priorities|risk|risks)\b/.test(query)) {
    return "companion";
  }
  if (/\b(find|search|show|list|get|emails?|mails?|messages?|comms?|communications?|from|with|about)\b/.test(query)) {
    return "search";
  }
  return "companion";
}

function sourceParam(mailbox: MailboxFilter) {
  if (mailbox === "Outlook") return "outlook";
  if (mailbox === "Teams") return "teams";
  if (mailbox === "Odoo Discuss") return "odoo_discuss";
  if (mailbox === "WhatsApp") return "whatsapp";
  return null;
}

function folderParam(mailbox: MailboxFilter) {
  return outlookFolderOptions.find((item) => item.label === mailbox)?.folder ?? null;
}

function isFlaggedView(mailbox: MailboxFilter) {
  return outlookFolderOptions.find((item) => item.label === mailbox)?.flagged === true;
}

function isUnreadView(mailbox: MailboxFilter) {
  return outlookFolderOptions.find((item) => item.label === mailbox)?.unread === true;
}

function sendProvider(source: string): ProviderName | null {
  if (source === "Outlook") return "Outlook";
  if (source === "Teams") return "Teams";
  if (source === "Odoo Discuss") return "Odoo Discuss";
  if (source === "WhatsApp") return "WhatsApp";
  return null;
}

function PlatformIcon({ source }: { source: string }) {
  const normalized = sourceClass(source);
  if (normalized === "whatsapp") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <path d="M6.8 25.6 8.1 21A10.6 10.6 0 1 1 12 24.7l-5.2.9Z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M12.4 10.9c.3-.7.5-.7.9-.7h.7c.2 0 .5.1.7.5l1 2.3c.1.3.1.6-.1.8l-.7.8c-.2.2-.2.5 0 .8.6 1 1.5 1.9 2.7 2.5.3.2.6.2.8-.1l.9-1c.2-.2.5-.3.8-.2l2.3 1.1c.4.2.5.5.5.8 0 .7-.5 1.6-1.1 2-.7.5-2.2.8-5-.5-4.2-1.9-6.9-5.9-7.1-8.1-.1-.7.8-1.3 1.1-2Z" fill="currentColor" />
      </svg>
    );
  }
  if (normalized === "outlook") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="5" y="8" width="22" height="17" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path d="m7 11 9 7 9-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="3.5" y="11" width="12" height="13" rx="2.5" fill="currentColor" opacity=".16" />
        <path d="M9.6 21.2c-2.1 0-3.6-1.6-3.6-3.9s1.5-4 3.6-4 3.6 1.6 3.6 4-1.5 3.9-3.6 3.9Zm0-1.8c1 0 1.6-.8 1.6-2.1s-.6-2.2-1.6-2.2S8 16 8 17.3s.6 2.1 1.6 2.1Z" fill="currentColor" />
      </svg>
    );
  }
  if (normalized === "teams") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <rect x="5" y="10" width="15" height="15" rx="3" fill="currentColor" opacity=".16" />
        <path d="M8 13h11M13.5 13v9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="22.5" cy="11" r="3" fill="currentColor" opacity=".42" />
        <circle cx="25.5" cy="15.5" r="2.2" fill="currentColor" opacity=".28" />
        <path d="M21 17.5h6v2.2c0 2.3-1.6 4.1-4 4.1-1.1 0-2-.3-2.7-.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (normalized === "odoo") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="10" cy="16" r="5" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <circle cx="22" cy="16" r="5" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <path d="M15 16h2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="7" y="7" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M11 13h10M11 18h7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <path d="m20 19 3 3 4-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function toInboxMessage(message: StoredMessage) {
  const source = sourceLabels[message.source];
  const receivedAt = message.received_at || message.sent_at || new Date().toISOString();
  const date = new Date(receivedAt);
  const contact = message.sender?.name || message.sender?.address || message.sender?.phone || source;
  const summary = message.preview || message.body_text.slice(0, 180) || "No message preview available.";
  const initials =
    contact
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "AR";

  return {
    id: message.id,
    externalId: message.external_id,
    source,
    destination: message.sender?.address || message.sender?.phone || message.external_thread_id || "",
    destinationLabel: message.sender?.address ? `${contact} (${message.sender.address})` : contact,
    subject: message.subject || undefined,
    contact,
    initials,
    title: message.subject || summary,
    summary,
    reason: message.ai_reason || "This looks like one of the latest items worth keeping in view.",
    detail: message.body_text || summary,
    priority: message.importance === "high" ? "high" : "medium",
    status: message.is_read ? "Read" : "Unread",
    isRead: message.is_read,
    isFlagged: message.is_flagged,
    mailFolder: message.mail_folder || "inbox",
    localStatus: message.local_status || "unhandled",
    dateGroup: "Today",
    displayDate: date.toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }),
    displayTime: date.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false }),
    receivedAt,
    draft: `Hi ${contact.split(" ")[0]} — thanks for the message. I’m checking this and will come back to you shortly.`,
  };
}

export default function Home() {
  const [inboxMessages, setInboxMessages] = useState<InboxMessage[]>(messages);
  const [activeMailbox, setActiveMailbox] = useState<MailboxFilter>("All mailboxes");
  const [selectedMessageId, setSelectedMessageId] = useState(messages[0].id);
  const [searchQuery, setSearchQuery] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [replyText, setReplyText] = useState(messages[0].draft);
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantHistory, setAssistantHistory] = useState<AssistantMessage[]>([
    {
      role: "assistant",
      content:
        "Ask me anything about this inbox — catch-up, priorities, what needs a reply, or help shaping a response. I won’t send anything.",
    },
  ]);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantNeedsAuth, setAssistantNeedsAuth] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeProvider, setComposeProvider] = useState<ProviderName>("Outlook");
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeBcc, setComposeBcc] = useState("");
  const [composeHeaders, setComposeHeaders] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [threadMessages, setThreadMessages] = useState<InboxMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyMode, setReplyMode] = useState<"reply" | "reply_all">("reply");
  const [theme, setTheme] = useState<"light" | "dark">("light");

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

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("allied-radar-theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("allied-radar-theme", theme);
  }, [theme]);

  async function loadMailboxMessages(mailbox: MailboxFilter, query = "") {
    const { data } = await getSupabaseBrowserClient().auth.getSession();
    if (!data.session) throw new Error("Connect Microsoft 365 before loading private inbox data.");
    const source = sourceParam(mailbox);
    const folder = folderParam(mailbox);
    const params = new URLSearchParams();
    if (source) params.set("source", source);
    if (folder) {
      params.set("source", "outlook");
      params.set("folder", folder);
    }
    if (isFlaggedView(mailbox)) {
      params.set("source", "outlook");
      params.set("flagged", "true");
    }
    if (isUnreadView(mailbox)) {
      params.set("unread", "true");
    }
    if (query.trim()) params.set("query", query.trim());
    const suffix = params.toString();
    const response = await fetch(`/api/inbox${suffix ? `?${suffix}` : ""}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });
    const payload = (await response.json()) as { messages?: StoredMessage[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Inbox load failed.");
    return (payload.messages || []).map(toInboxMessage) as InboxMessage[];
  }

  async function loadThread(message: InboxMessage) {
    setThreadLoading(true);
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session) {
        setThreadMessages([message]);
        return;
      }
      const response = await fetch(`/api/inbox/thread?messageId=${encodeURIComponent(message.id)}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${data.session.access_token}` },
      });
      const payload = (await response.json()) as { messages?: StoredMessage[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Thread load failed.");
      const liveThread = (payload.messages || []).map(toInboxMessage) as InboxMessage[];
      setThreadMessages(liveThread.length ? liveThread : [message]);
    } catch {
      setThreadMessages([message]);
    } finally {
      setThreadLoading(false);
    }
  }

  async function markLocalMessage(message: InboxMessage, action: "open" | "acknowledge") {
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session) return;
      await fetch("/api/messages/ack", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messageId: message.id, action }),
      });
      setInboxMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? { ...item, localStatus: action === "acknowledge" ? "acknowledged" : "opened" }
            : item,
        ),
      );
    } catch {
      // Local acknowledge is best-effort and never marks the source inbox read.
    }
  }

  async function runMessageAction(
    message: InboxMessage,
    action: "mark_read" | "mark_unread" | "flag" | "unflag" | "archive" | "delete",
  ) {
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error("Connect Microsoft 365 before using mail actions.");
      const response = await fetch("/api/messages/actions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messageId: message.id, action }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Message action failed.");
      const folderPatch =
        action === "archive" ? { mailFolder: "archive" } :
        action === "delete" ? { mailFolder: "deleted" } :
        {};
      setInboxMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? {
                ...item,
                ...folderPatch,
                isRead: action === "mark_read" ? true : action === "mark_unread" ? false : item.isRead,
                status: action === "mark_read" ? "Read" : action === "mark_unread" ? "Unread" : item.status,
                isFlagged: action === "flag" ? true : action === "unflag" ? false : item.isFlagged,
              }
            : item,
        ),
      );
      setSearchNote(`Outlook ${action.replace("_", " ")} completed.`);
    } catch (error) {
      setSearchNote(error instanceof Error ? error.message : "Message action failed.");
    }
  }

  useEffect(() => {
    let active = true;
    async function loadInbox() {
      try {
        const liveMessages = await loadMailboxMessages("All mailboxes");
        if (!liveMessages.length || !active) return;
        setInboxMessages(liveMessages);
        setSelectedMessageId(liveMessages[0].id);
        setReplyText(liveMessages[0].draft);
        void loadThread(liveMessages[0]);
        setSearchNote("Live messages loaded from your private Supabase inbox.");
      } catch {
        // Preview data stays in place while setup is incomplete.
      }
    }
    void loadInbox();
    return () => {
      active = false;
    };
  }, []);

  const visibleMessages = useMemo(() => {
    const mailboxMessages =
      activeMailbox === "All mailboxes"
        ? inboxMessages
        : sourceParam(activeMailbox)
          ? inboxMessages.filter((message) => message.source === activeMailbox)
          : folderParam(activeMailbox)
            ? inboxMessages.filter((message) => message.source === "Outlook" && message.mailFolder === folderParam(activeMailbox))
            : isFlaggedView(activeMailbox)
              ? inboxMessages.filter((message) => message.source === "Outlook" && message.isFlagged)
              : isUnreadView(activeMailbox)
                ? inboxMessages.filter((message) => !message.isRead)
                : inboxMessages;
    const query = appliedSearch.trim().toLowerCase();
    if (!query) return mailboxMessages;
    return mailboxMessages.filter((message) =>
      [message.contact, message.title, message.summary, message.source].join(" ").toLowerCase().includes(query),
    );
  }, [activeMailbox, appliedSearch, inboxMessages]);

  const selectedMessage =
    visibleMessages.find((message) => message.id === selectedMessageId) ?? visibleMessages[0] ?? inboxMessages[0];
  const selectedProvider = selectedMessage ? sendProvider(selectedMessage.source) : null;

  async function selectMailbox(mailbox: MailboxFilter) {
    setActiveMailbox(mailbox);
    setAppliedSearch("");
    setSearching(true);
    try {
      const liveMessages = await loadMailboxMessages(mailbox);
      setInboxMessages(liveMessages);
      const next = liveMessages[0];
      if (next) {
        setSelectedMessageId(next.id);
        setReplyText(next.draft);
        setReplyMode("reply");
        setAssistantOpen(false);
        void loadThread(next);
        setSearchNote(`${mailbox} loaded from Supabase.`);
      } else {
        setSearchNote(`${mailbox} has no imported messages yet.`);
      }
    } catch (error) {
      const next =
        mailbox === "All mailboxes" ? inboxMessages[0] : inboxMessages.find((message) => message.source === mailbox);
      if (next) {
        setSelectedMessageId(next.id);
        setReplyText(next.draft);
      }
      setSearchNote(error instanceof Error ? error.message : "Mailbox load failed.");
    } finally {
      setSearching(false);
    }
  }

  function selectMessage(message: InboxMessage) {
    setSelectedMessageId(message.id);
    setReplyText(message.draft);
    setReplyMode("reply");
    setAssistantOpen(false);
    void loadThread(message);
    void markLocalMessage(message, "open");
    setAssistantHistory([
      {
        role: "assistant",
        content: `I’m looking at ${message.contact} in ${message.source}. Ask for a catch-up, risks, next actions, or a reply draft.`,
      },
    ]);
  }

  async function askAssistant(event?: React.FormEvent<HTMLFormElement>, promptOverride?: string) {
    event?.preventDefault();
    const question = (promptOverride ?? assistantQuestion).trim();
    if (!question || assistantBusy) return;

    setAssistantOpen(true);
    const nextHistory: AssistantMessage[] = [...assistantHistory, { role: "user", content: question }];
    setAssistantHistory(nextHistory);
    setAssistantQuestion("");
    setAssistantBusy(true);

    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session) {
        setAssistantNeedsAuth(true);
        throw new Error("Connect Microsoft 365 so AI companion can read your private inbox context safely.");
      }
      setAssistantNeedsAuth(false);

      const response = await fetch("/api/ai/copilot", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          selectedMessageId: selectedMessage?.id,
          history: assistantHistory,
        }),
      });
      const payload = (await response.json()) as { answer?: string; error?: string; model?: string };
      if (!response.ok) throw new Error(payload.error || "AI companion is unavailable.");
      setAssistantHistory([
        ...nextHistory,
        {
          role: "assistant",
          content: payload.answer || "I could not produce a useful answer from the current inbox context.",
        },
      ]);
    } catch (error) {
      setAssistantHistory([
        ...nextHistory,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? error.message
              : "I couldn’t reach the private assistant endpoint. Nothing was sent.",
        },
      ]);
    } finally {
      setAssistantBusy(false);
    }
  }

  async function connectMicrosoft() {
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: MICROSOFT_GRAPH_SCOPES,
        },
      });
      if (error) throw error;
    } catch (error) {
      setAssistantHistory((current) => [
        ...current,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "Microsoft sign-in could not start.",
        },
      ]);
    }
  }

  async function searchMailboxes(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    setAppliedSearch("");
    if (!query) {
      setSearchNote(null);
      setSearching(true);
      try {
        const { data } = await getSupabaseBrowserClient().auth.getSession();
        if (!data.session) return;
        const liveMessages = await loadMailboxMessages(activeMailbox);
        if (liveMessages.length) {
          setInboxMessages(liveMessages);
          setSelectedMessageId(liveMessages[0].id);
          setReplyText(liveMessages[0].draft);
          void loadThread(liveMessages[0]);
        }
      } catch (error) {
        setSearchNote(error instanceof Error ? error.message : "Inbox reload failed.");
      } finally {
        setSearching(false);
      }
      return;
    }
    setSearching(true);
    try {
      const { data } = await getSupabaseBrowserClient().auth.getSession();
      if (!data.session) throw new Error("Connect Microsoft 365 before private inbox search can run.");

      if (commandIntent(query) === "companion") {
        setSearchNote(`AI companion is checking "${query}".`);
        setSearchQuery("");
        await askAssistant(undefined, query);
        return;
      }

      const liveMessages = await loadMailboxMessages(activeMailbox, query);
      setInboxMessages(liveMessages);
      if (liveMessages[0]) {
        setSelectedMessageId(liveMessages[0].id);
        setReplyText(liveMessages[0].draft);
        void loadThread(liveMessages[0]);
      }
      setSearchNote(
        liveMessages.length
          ? `Found ${liveMessages.length} imported inbox result${liveMessages.length === 1 ? "" : "s"} for "${query}".`
          : `No imported inbox results found for "${query}".`,
      );
      setAssistantOpen(true);
      await askAssistant(
        undefined,
        liveMessages.length
          ? `Break down the inbox search "${query}". Give me the main people, sources, dates, open loops, and best next options.`
          : `I searched for "${query}" but found no imported inbox results. Suggest better searches or filters to try.`,
      );
    } catch (error) {
      setAppliedSearch(query);
      setSearchNote(error instanceof Error ? error.message : "Inbox search is unavailable.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <main className="app-shell" data-theme={theme}>
      <div className="desktop-stage" aria-label="Allied Radar unified inbox">
        <div className="sr-only">
          Mailbox navigation. Latest across every inbox. AI workspace. AI draft / human send. Private local assistant.
        </div>
        <aside className="platform-rail" aria-label="Mailboxes">
          <button className="rail-brand" type="button" aria-label="Allied Radar home">
            ◈
          </button>
          <nav>
            {mailboxOptions.map((mailbox) => (
              <button
                key={mailbox.label}
                type="button"
                className={activeMailbox === mailbox.label ? "rail-button active" : "rail-button"}
                aria-current={activeMailbox === mailbox.label ? "page" : undefined}
                aria-label={mailbox.label}
                onClick={() => selectMailbox(mailbox.label)}
              >
                <span className={`source-glyph ${mailbox.className}`}>
                  <PlatformIcon source={mailbox.label} />
                </span>
              </button>
            ))}
          </nav>
          <button
            className="theme-toggle"
            type="button"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button
            className="rail-avatar"
            type="button"
            aria-label="Open account connections"
            onClick={() => setConnectionsOpen(true)}
          >
            F
          </button>
        </aside>

        <aside className="folder-sidebar" aria-label="Folders and sources">
          <div className="folder-sidebar-header">
            <p>Workspace</p>
            <strong>Radar</strong>
          </div>

          <button
            type="button"
            className={activeMailbox === "All mailboxes" ? "folder-primary active" : "folder-primary"}
            onClick={() => void selectMailbox("All mailboxes")}
          >
            <span className="folder-label">
              <span className="source-glyph all">
                <PlatformIcon source="All mailboxes" />
              </span>
              All mailboxes
            </span>
            <span>{visibleMessages.length}</span>
          </button>

          <div className="folder-section">
            <p>Sources</p>
            {mailboxOptions.slice(1).map((mailbox) => (
              <button
                key={mailbox.label}
                type="button"
                className={activeMailbox === mailbox.label ? "folder-link active" : "folder-link"}
                onClick={() => void selectMailbox(mailbox.label)}
              >
                <span className="folder-label">
                  <span className={`source-glyph ${mailbox.className}`}>
                    <PlatformIcon source={mailbox.label} />
                  </span>
                  {mailbox.label === "Odoo Discuss" ? "Odoo" : mailbox.label}
                </span>
              </button>
            ))}
          </div>

          <div className="folder-section">
            <p>Outlook</p>
            {outlookFolderOptions.map((folder) => (
              <button
                className={activeMailbox === folder.label ? "folder-link active" : "folder-link"}
                key={folder.label}
                type="button"
                onClick={() => void selectMailbox(folder.label)}
              >
                <span>{folder.label}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="inbox-window">
          <form className="ask-bar" onSubmit={searchMailboxes}>
            <span className="ask-orb" aria-hidden="true" />
            <input
              aria-label="Ask or search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Start typing to ask or search"
            />
            <button type="submit" disabled={searching}>
              {searching ? "…" : "Ask"}
            </button>
          </form>

          <div className="inbox-title-row">
            <div>
              <p>Good morning, Ferdi.</p>
              <h1>{activeMailbox}</h1>
            </div>
            <div className="inbox-title-actions">
              <button type="button" onClick={() => setComposeOpen(true)}>
                New message
              </button>
              <span>{visibleMessages.length} messages</span>
            </div>
          </div>

          <p className="search-note">{searchNote || "Live messages loaded from your private Supabase inbox."}</p>

          <div className="message-list" aria-label={`${activeMailbox} messages`}>
            {visibleMessages.map((message, index) => {
              const showDate = activeMailbox === "All mailboxes" && (index === 0 || index === 3);
              return (
                <div className="message-group" key={message.id}>
                  {showDate && (
                    <div className="date-stamp">
                      <span>{index === 0 ? "Today" : "Earlier"}</span>
                      <time dateTime={message.receivedAt}>{message.displayDate}</time>
                    </div>
                  )}
                  <button
                    type="button"
                    className={selectedMessage.id === message.id ? "message-row selected" : "message-row"}
                    onClick={() => selectMessage(message)}
                  >
                    <span className="avatar">{message.initials}</span>
                    <span className="row-copy">
                      <span className="row-topline">
                        <strong>{message.contact}</strong>
                        <time dateTime={message.receivedAt}>{message.displayTime}</time>
                      </span>
                      <span className="row-summary">{message.summary}</span>
                      <span className="row-source">
                        {message.source}
                        {message.source === "Outlook" ? ` · ${message.mailFolder}` : ""}
                        {message.isFlagged ? " · flagged" : ""}
                      </span>
                    </span>
                    <span className={`source-glyph ${sourceClass(message.source)}`} aria-label={message.source}>
                      <PlatformIcon source={message.source} />
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="right-zone" aria-label="AI observations and conversation">
          <section className="thread-card">
            {!selectedMessage ? (
              <div className="empty-reader">
                <p>{activeMailbox}</p>
                <h2>No message selected</h2>
                <span>
                  Try clearing the search, syncing connected inboxes, or choosing another mailbox.
                </span>
              </div>
            ) : (
            <>
            <header className="thread-header">
              <div>
                <p>{selectedMessage.source}</p>
                <h2>{selectedMessage.contact}</h2>
                <span>{selectedMessage.destinationLabel}</span>
              </div>
              <div className="thread-header-actions">
                <button type="button" className="secondary-action" onClick={() => void markLocalMessage(selectedMessage, "acknowledge")}>
                  Mark handled
                </button>
                {selectedMessage.source === "Outlook" && (
                  <>
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => void runMessageAction(selectedMessage, selectedMessage.isRead ? "mark_unread" : "mark_read")}
                    >
                      {selectedMessage.isRead ? "Mark unread" : "Mark read"}
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => void runMessageAction(selectedMessage, selectedMessage.isFlagged ? "unflag" : "flag")}
                    >
                      {selectedMessage.isFlagged ? "Unflag" : "Flag"}
                    </button>
                    <button type="button" className="secondary-action" onClick={() => void runMessageAction(selectedMessage, "archive")}>
                      Archive
                    </button>
                    <button type="button" className="secondary-action danger" onClick={() => void runMessageAction(selectedMessage, "delete")}>
                      Delete
                    </button>
                  </>
                )}
                <button type="button" onClick={() => setAssistantOpen(true)}>
                  Open AI companion
                </button>
                <span className={`source-glyph ${sourceClass(selectedMessage.source)}`} aria-hidden="true">
                  <PlatformIcon source={selectedMessage.source} />
                </span>
              </div>
            </header>

            <div className="thread-scroll">
              <time className="thread-date" dateTime={selectedMessage.receivedAt}>
                {selectedMessage.displayDate} · {selectedMessage.displayTime}
              </time>
              {threadLoading && <p className="thread-loading">Loading thread…</p>}
              {(threadMessages.length ? threadMessages : [selectedMessage]).map((threadMessage) => (
                <article
                  className={threadMessage.id === selectedMessage.id ? "bubble incoming selected-thread-message" : "bubble incoming"}
                  key={threadMessage.id}
                >
                  <div className="thread-message-heading">
                    <strong>{threadMessage.contact}</strong>
                    <time dateTime={threadMessage.receivedAt}>
                      {threadMessage.displayDate} · {threadMessage.displayTime}
                    </time>
                  </div>
                  {threadMessage.subject && <h3>{threadMessage.subject}</h3>}
                  <p>{threadMessage.detail}</p>
                </article>
              ))}
            </div>

            {assistantOpen && (
              <section className="assistant-chat copilot-panel" aria-label="AI companion inbox assistant">
                <header>
                  <div>
                    <strong>AI companion</strong>
                    <small>{AI_MODEL_LABEL} · chat, search, summaries, drafts</small>
                  </div>
                  <button type="button" onClick={() => setAssistantOpen(false)}>
                    Close
                  </button>
                </header>

                <div className="quick-prompts" aria-label="Suggested assistant prompts">
                  {["Catch me up", "What needs reply?", "Draft a short reply"].map((prompt) => (
                    <button key={prompt} type="button" onClick={() => void askAssistant(undefined, prompt)}>
                      {prompt}
                    </button>
                  ))}
                </div>

                <div className="assistant-messages">
                  {assistantHistory.map((message, index) => (
                    <article className={`assistant-bubble ${message.role}`} key={`${message.role}-${index}`}>
                      {message.content}
                    </article>
                  ))}
                  {assistantBusy && <article className="assistant-bubble assistant">Thinking…</article>}
                </div>

                {assistantNeedsAuth && (
                  <div className="auth-needed-card">
                    <div>
                      <strong>Connect before AI companion reads inbox context</strong>
                      <p>
                        This keeps private Outlook, Teams, Odoo, and WhatsApp context behind your Supabase session.
                      </p>
                    </div>
                    <button type="button" onClick={() => void connectMicrosoft()}>
                      Connect Microsoft 365
                    </button>
                  </div>
                )}

                <form className="assistant-input" onSubmit={(event) => void askAssistant(event)}>
                  <input
                    aria-label="Ask AI companion about your inbox"
                    value={assistantQuestion}
                    onChange={(event) => setAssistantQuestion(event.target.value)}
                    placeholder="Ask about this thread or your inbox…"
                  />
                  <button type="submit" disabled={assistantBusy}>
                    Ask
                  </button>
                </form>
              </section>
            )}

            <footer className="reply-composer">
              {selectedProvider ? (
                <>
                  <div className="reply-mode-tabs" aria-label="Reply mode">
                    <button
                      className={replyMode === "reply" ? "active" : ""}
                      type="button"
                      onClick={() => setReplyMode("reply")}
                    >
                      Reply
                    </button>
                    {selectedMessage.source === "Outlook" && selectedMessage.externalId && (
                      <button
                        className={replyMode === "reply_all" ? "active" : ""}
                        type="button"
                        onClick={() => setReplyMode("reply_all")}
                      >
                        Reply all
                      </button>
                    )}
                  </div>
                  <SendComposer
                    key={`${selectedMessage.id}-${selectedMessage.externalId || "draft"}-${replyMode}`}
                    provider={selectedProvider}
                    destination={selectedMessage.destination}
                    destinationLabel={selectedMessage.destinationLabel}
                    subject={selectedMessage.subject}
                    replyToId={selectedMessage.source === "Outlook" ? selectedMessage.externalId : undefined}
                    replyMode={selectedMessage.source === "Outlook" ? replyMode : "reply"}
                    draftKey={`${selectedMessage.source}:${selectedMessage.externalId || selectedMessage.id}`}
                    initialContent={replyText}
                    sourceMessage={selectedMessage.detail}
                    context={`Selected inbox thread from ${selectedMessage.source}: ${(threadMessages.length ? threadMessages : [selectedMessage])
                      .map((item) => `${item.contact}: ${item.summary}`)
                      .join("\n")}`}
                    aiActions={["Shorten", "Make warmer", "Make firmer", "Add context"]}
                    compact
                  />
                </>
              ) : (
                <p className="send-feedback error">This source cannot send from Radar yet.</p>
              )}
            </footer>
            </>
            )}
          </section>
        </aside>
      </div>

      {connectionsOpen && <ConnectionCenter onClose={() => setConnectionsOpen(false)} />}

      {composeOpen && (
        <div
          className="compose-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setComposeOpen(false);
          }}
        >
          <section className="compose-dialog" role="dialog" aria-modal="true" aria-labelledby="compose-title">
            <div className="confirmation-heading">
              <div>
                <p className="eyebrow">New message</p>
                <h3 id="compose-title">Choose where to send from</h3>
              </div>
              <button className="dialog-close" type="button" onClick={() => setComposeOpen(false)}>
                Close
              </button>
            </div>
            <div className="compose-provider-picker" aria-label="Send from">
              {(["Outlook", "WhatsApp", "Teams", "Odoo Discuss"] as ProviderName[]).map((provider) => (
                <button
                  key={provider}
                  type="button"
                  className={composeProvider === provider ? "active" : ""}
                  onClick={() => setComposeProvider(provider)}
                >
                  <span className={`source-glyph ${sourceClass(provider)}`} aria-hidden="true">
                    <PlatformIcon source={provider} />
                  </span>
                  {provider}
                </button>
              ))}
            </div>
            <label className="compose-input inline-compose-input">
              <span>{composeProvider === "WhatsApp" ? "Phone" : composeProvider === "Outlook" ? "To" : "Thread"}</span>
              <input
                value={composeTo}
                onChange={(event) => setComposeTo(event.target.value)}
                placeholder={composeProvider === "WhatsApp" ? "+27..." : composeProvider === "Outlook" ? "name@company.com" : "chat/thread id"}
                inputMode={composeProvider === "WhatsApp" ? "tel" : "email"}
              />
            </label>
            {composeProvider === "Outlook" && <label className="compose-input inline-compose-input">
              <span>Subject</span>
              <input
                value={composeSubject}
                onChange={(event) => setComposeSubject(event.target.value)}
                placeholder="Subject"
              />
            </label>}
            {composeProvider === "Outlook" && <label className="compose-input inline-compose-input">
              <span>CC</span>
              <input
                value={composeCc}
                onChange={(event) => setComposeCc(event.target.value)}
                placeholder="cc@example.com, another@example.com"
                inputMode="email"
              />
            </label>}
            {composeProvider === "Outlook" && <label className="compose-input inline-compose-input">
              <span>BCC</span>
              <input
                value={composeBcc}
                onChange={(event) => setComposeBcc(event.target.value)}
                placeholder="bcc@example.com"
                inputMode="email"
              />
            </label>}
            {composeProvider === "Outlook" && <label className="compose-input inline-compose-input">
              <span>Email headers</span>
              <textarea
                value={composeHeaders}
                onChange={(event) => setComposeHeaders(event.target.value)}
                placeholder={"x-project-id: SO00052\nx-radar-source: allied-radar"}
              />
            </label>}
            <label className="compose-input inline-compose-input">
              <span>Starting draft</span>
              <textarea
                value={composeBody}
                onChange={(event) => setComposeBody(event.target.value)}
                placeholder="Type your email here. Radar can shorten, warm up, or firm up the wording before you send."
              />
            </label>
            {true ? (
              <SendComposer
                key={`${composeTo}-${composeSubject}`}
                provider={composeProvider}
                destination={composeTo.trim()}
                destinationLabel={composeTo.trim()}
                draftKey={`new:${composeProvider}:${composeTo.trim() || "empty"}`}
                subject={composeProvider === "Outlook" ? composeSubject.trim() || undefined : undefined}
                cc={composeProvider === "Outlook" ? parseAddressList(composeCc) : undefined}
                bcc={composeProvider === "Outlook" ? parseAddressList(composeBcc) : undefined}
                internetMessageHeaders={composeProvider === "Outlook" ? parseHeaderList(composeHeaders) : undefined}
                initialContent={composeBody || "Hi —"}
                context={`New ${composeProvider} message drafted from Allied Radar.`}
                aiActions={["Shorten", "Make warmer", "Make firmer", "Add context"]}
              />
            ) : (
              <p className="search-note">Add a recipient first, then Radar will unlock the reviewed send controls.</p>
            )}
          </section>
        </div>
      )}

      <section className="mobile-shell" aria-label="Mobile unified inbox">
        <header className="mobile-header">
          <p>Good morning, Ferdi.</p>
          <h1>You’ve got {inboxMessages.length} new and active conversations</h1>
          <form className="ask-bar mobile" onSubmit={searchMailboxes}>
            <span className="ask-orb" aria-hidden="true" />
            <input
              aria-label="Mobile ask or search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Ask AI companion"
            />
            <button type="submit">↗</button>
          </form>
        </header>

        <div className="mobile-list">
          {visibleMessages.map((message) => (
            <button className="mobile-row" key={message.id} type="button" onClick={() => selectMessage(message)}>
              <span className="avatar">{message.initials}</span>
              <span>
                <strong>{message.contact}</strong>
                <small>{message.summary}</small>
              </span>
              <span className={`source-glyph ${sourceClass(message.source)}`} aria-hidden="true">
                <PlatformIcon source={message.source} />
              </span>
            </button>
          ))}
        </div>

        <nav className="bottom-tabs" aria-label="Mobile mailbox tabs">
          {mailboxOptions.slice(0, 5).map((mailbox) => (
            <button
              className={activeMailbox === mailbox.label ? "active" : ""}
              key={mailbox.label}
              type="button"
              onClick={() => selectMailbox(mailbox.label)}
              aria-label={mailbox.label}
            >
              <span className={`source-glyph ${mailbox.className}`}>
                <PlatformIcon source={mailbox.label} />
              </span>
            </button>
          ))}
        </nav>
      </section>
    </main>
  );
}
