// src/core/cbq.ts
// Structured, versioned callback_data with short HMAC signature.
// Format (v1): cbq:v1:<module>:<action>:<payload>:<sig>
// - payload is a compact string (keep it short to respect Telegram limits)
// - sig = base64url(HMAC_SHA256(secret, body)).slice(0, 10)

import crypto from "node:crypto";
import { CBQ_SECRET } from "./config";

export type CbqV1 = {
  v: "v1";
  module: string;
  action: string;
  payload: string;
};

const PREFIX = "cbq";

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sign(body: string, secret = CBQ_SECRET): string {
  const mac = crypto.createHmac("sha256", secret).update(body).digest();
  // 10 chars is enough to stop casual spoofing and keeps data short.
  return b64url(mac).slice(0, 10);
}

export function encodeCbq(module: string, action: string, payload: string = ""): string {
  const safe = (s: string) => (s ?? "").replace(/:/g, "_");
  const body = [PREFIX, "v1", safe(module), safe(action), safe(payload)].join(":");
  const sig = sign(body);
  return `${body}:${sig}`;
}

export function decodeCbq(data: string, secret = CBQ_SECRET): { ok: true; value: CbqV1 } | { ok: false; reason: string } {
  if (!data || !data.startsWith(`${PREFIX}:v1:`)) return { ok: false, reason: "not_cbq" };
  const parts = data.split(":");
  if (parts.length < 6) return { ok: false, reason: "bad_format" };

  const sig = parts.pop()!;
  const body = parts.join(":");
  const expected = sign(body, secret);
  if (sig !== expected) return { ok: false, reason: "bad_signature" };

  const [, v, module, action, payload] = parts;
  if (v !== "v1") return { ok: false, reason: "bad_version" };

  return {
    ok: true,
    value: { v: "v1", module, action, payload: payload ?? "" },
  };
}
