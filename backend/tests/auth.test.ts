import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  hashPassword,
  verifyPassword,
} from "../src/auth/password.js";
import {
  signJwt,
  verifyJwt,
} from "../src/auth/jwt.js";
import { pseudoEmbedding, cosine, safeEqual, hmacSha256Hex } from "../src/crypto.js";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("produces different hashes for the same password", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("jwt", () => {
  it("signs and verifies an access token", () => {
    const token = signJwt(
      { sub: "user-1", typ: "access", sid: "s1", exp: Math.floor(Date.now() / 1000) + 60 },
      "secret",
    );
    const payload = verifyJwt(token, "secret");
    expect(payload?.sub).toBe("user-1");
    expect(payload?.typ).toBe("access");
  });

  it("rejects tampered tokens", () => {
    const token = signJwt(
      { sub: "user-1", typ: "access", exp: Math.floor(Date.now() / 1000) + 60 },
      "secret",
    );
    expect(verifyJwt(token + "x", "secret")).toBeNull();
    expect(verifyJwt(token, "other-secret")).toBeNull();
  });

  it("rejects expired tokens", () => {
    const token = signJwt(
      { sub: "u", typ: "access", exp: Math.floor(Date.now() / 1000) - 10 },
      "s",
    );
    expect(verifyJwt(token, "s")).toBeNull();
  });
});

describe("crypto helpers", () => {
  it("computes cosine similarity on normalized vectors", () => {
    const a = pseudoEmbedding("yo are you coming tonight");
    const b = pseudoEmbedding("are you coming tonight");
    const c = pseudoEmbedding("invoice deadline tomorrow");
    expect(cosine(a, b)).toBeGreaterThan(cosine(a, c));
    expect(Math.abs(cosine(a, a) - 1)).toBeLessThan(0.001);
  });

  it("safeEqual is timing-safe compare", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("hmac works", () => {
    const h = hmacSha256Hex("k", "data");
    expect(h).toHaveLength(64);
  });
});
