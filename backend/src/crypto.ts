import crypto from "node:crypto";

/** URL-safe base64 random token. */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Timing-safe string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/** Deterministic 1536-dim style embedding (truncated), L2-normalized. */
export function pseudoEmbedding(text: string, dims = 256): number[] {
  const v = new Array<number>(dims).fill(0);
  const norm = text.toLowerCase();
  const tokens = norm.match(/[a-z0-9\u0900-\u097F']+/g) ?? [];
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    v[Math.abs(h) % dims] += 1;
    // add bigram signal
    let h2 = 5381;
    h2 = (h2 * 33 + tok.charCodeAt(0)) >>> 0;
    if (tok.length > 1) h2 = (h2 * 33 + tok.charCodeAt(tok.length - 1)) >>> 0;
    v[h2 % dims] += 0.5;
  }
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum) || 1;
  return v.map((x) => x / len);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) dot += a[i] * b[i];
  return dot; // vectors are pre-normalized
}
