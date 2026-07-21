import { NextResponse } from "next/server";
import { ApiError } from "./errors";

export function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}

export function apiErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return noStoreJson(
      { ok: false, code: error.code, error: error.message },
      { status: error.status },
    );
  }

  return noStoreJson(
    { ok: false, code: "request_failed", error: "Request could not be completed." },
    { status: 500 },
  );
}
