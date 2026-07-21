import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

async function request(path = "/", init = {}) {
  const worker = await loadWorker();
  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

const confirmedMessage = {
  provider: "Outlook",
  destination: "recipient@example.com",
  destinationLabel: "Test Recipient",
  subject: "Test",
  content: "This is a reviewed test message.",
  clientRequestId: "7db21bb8-36ab-4e6f-bb0f-50aa260e956d",
  confirmation: {
    action: "send_now",
    recipient: "Test Recipient",
    reviewed: true,
  },
};

test("server-renders the Allied Radar send workflow", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Allied Radar/);
  assert.match(html, /All mailboxes/);
  assert.match(html, /Mailbox navigation/);
  assert.match(html, /Latest across every inbox/);
  assert.match(html, /17 Jul 2026/);
  assert.match(html, /AI workspace/);
  assert.match(html, /AI draft \/ human send/i);
  assert.match(html, /cannot press send/i);
  assert.match(html, /Review &amp; send/i);
  assert.match(html, /Private local assistant/);
  assert.match(html, /WhatsApp/);
  assert.match(html, /Odoo Discuss/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});

test("reports providers as paused until explicitly enabled", async () => {
  const response = await request("/api/messages/providers");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.sendEnabled, false);
  assert.equal(payload.confirmationReady, false);
  assert.equal(payload.aiMode, "draft_only");
  assert.equal(payload.confirmationRequired, true);
  assert.equal(payload.providers.length, 4);
});

test("rejects unauthenticated send requests", async () => {
  const response = await request("/api/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(confirmedMessage),
  });
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.code, "unauthorized");
});

test("authentication is required before the master send switch is evaluated", async () => {
  const response = await request("/api/messages/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Allied-User-Intent": "confirm-send",
    },
    body: JSON.stringify(confirmedMessage),
  });
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.code, "unauthorized");
});

test("rejects unauthenticated AI requests before contacting OpenRouter", async () => {
  const response = await request("/api/ai/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Do not send this test content." }),
  });
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.code, "unauthorized");
});

test("keeps AI drafting separate from deterministic delivery", async () => {
  const [guardrails, sendRoute, providers, page, packageJson] = await Promise.all([
    readFile(new URL("../lib/guardrails.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/messages/send/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/messaging/providers.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(guardrails, /AI_OUTPUT_MODE = "draft_only"/);
  assert.match(guardrails, /ENABLE_SEND_ACTIONS === "true"/);
  assert.match(sendRoute, /X-Allied-User-Intent/);
  assert.match(sendRoute, /parseConfirmedSendRequest/);
  assert.match(providers, /graph\.microsoft\.com\/v1\.0\/me\/sendMail/);
  assert.match(providers, /https:\/\/wa\.me/);
  assert.match(page, /SendComposer/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
