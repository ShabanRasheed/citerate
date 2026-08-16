/**
 * AES-GCM sealing for third-party tokens at rest (Phase 10). The key derives
 * from SESSION_SECRET (SHA-256 → 256-bit AES key), so rotating the secret also
 * invalidates every stored token — the safe failure. Output is
 * base64(iv ‖ ciphertext).
 */
const keyFor = async (secret: string): Promise<CryptoKey> => {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
};

const toB64 = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function seal(secret: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await keyFor(secret),
    new TextEncoder().encode(plaintext)
  );
  const out = new Uint8Array(iv.length + cipher.byteLength);
  out.set(iv);
  out.set(new Uint8Array(cipher), iv.length);
  return toB64(out);
}

/** Returns null on any tamper or key rotation — callers treat that as "reconnect". */
export async function open(secret: string, sealed: string): Promise<string | null> {
  try {
    const bytes = fromB64(sealed);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, 12) },
      await keyFor(secret),
      bytes.slice(12)
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
