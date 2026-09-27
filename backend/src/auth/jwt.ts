import crypto from "node:crypto";

/**
 * Minimal HS256 JWT implementation (sign + verify) to avoid extra deps.
 */
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export interface JwtPayload {
  sub: string;
  typ: "access" | "refresh";
  sid?: string;
  exp: number;
  iat: number;
}

export function signJwt(
  payload: Omit<JwtPayload, "iat">,
  secret: string,
): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as JwtPayload;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
