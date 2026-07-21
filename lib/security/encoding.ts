import { ConfigurationError } from "./errors";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function utf8ToBytes(value: string) {
  return textEncoder.encode(value);
}

export function bytesToUtf8(value: BufferSource) {
  return textDecoder.decode(value);
}

export function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function keyMaterialFromBase64(value: string, expectedBytes = 32) {
  try {
    const bytes = base64UrlToBytes(value.trim());
    if (bytes.byteLength !== expectedBytes) {
      throw new ConfigurationError();
    }
    return bytes;
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError();
  }
}
