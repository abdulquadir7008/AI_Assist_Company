import { describe, expect, it } from "vitest";
import { CODE_TTL_MS, codeState, generateCode, hashCode, MAX_ATTEMPTS } from "./codes.js";
import { evaluateLogin } from "./loginPolicy.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { slugify, withSuffix } from "./slug.js";
import { signToken, TokenError, verifyToken } from "./tokens.js";

const SECRET = "test-secret-for-auth-tests";

describe("passwords", () => {
  it("hash/verify roundtrip; wrong password rejected", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });

  it("hashes are salted (two hashes of the same input differ)", async () => {
    const [a, b] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(a).not.toBe(b);
  });
});

describe("verification codes", () => {
  it("generates zero-padded 6-digit codes", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateCode()).toMatch(/^\d{6}$/);
    }
  });

  it("hashCode is deterministic and not the plain code", () => {
    expect(hashCode("123456")).toBe(hashCode("123456"));
    expect(hashCode("123456")).not.toContain("123456");
  });

  it("codeState matrix: valid / expired / consumed / locked", () => {
    const now = new Date("2026-07-17T10:00:00Z");
    const base = { expiresAt: new Date(now.getTime() + CODE_TTL_MS), consumedAt: null, attempts: 0 };

    expect(codeState(base, now)).toBe("valid");
    expect(codeState({ ...base, expiresAt: new Date(now.getTime() - 1) }, now)).toBe("expired");
    expect(codeState({ ...base, consumedAt: now }, now)).toBe("consumed");
    expect(codeState({ ...base, attempts: MAX_ATTEMPTS }, now)).toBe("locked");
    expect(codeState({ ...base, attempts: MAX_ATTEMPTS - 1 }, now)).toBe("valid");
  });
});

describe("tokens: root/user scope wall", () => {
  it("sign → verify roundtrip returns the subject", () => {
    const token = signToken({ sub: "user-1", typ: "user" }, SECRET, "1h");
    expect(verifyToken(token, "user", SECRET)).toEqual({ sub: "user-1" });
  });

  it("a root token is REJECTED when a user token is expected", () => {
    const rootToken = signToken({ sub: "root-1", typ: "root" }, SECRET, "1h");
    expect(() => verifyToken(rootToken, "user", SECRET)).toThrow(TokenError);
  });

  it("a user token is REJECTED on the root surface", () => {
    const userToken = signToken({ sub: "user-1", typ: "user" }, SECRET, "1h");
    expect(() => verifyToken(userToken, "root", SECRET)).toThrow(TokenError);
  });

  it("tampered and wrong-secret tokens throw", () => {
    const token = signToken({ sub: "user-1", typ: "user" }, SECRET, "1h");
    expect(() => verifyToken(token + "x", "user", SECRET)).toThrow(TokenError);
    expect(() => verifyToken(token, "user", "other-secret")).toThrow(TokenError);
  });

  it("expired tokens throw", () => {
    const token = signToken({ sub: "user-1", typ: "user" }, SECRET, "-1s");
    expect(() => verifyToken(token, "user", SECRET)).toThrow(TokenError);
  });
});

describe("slugify", () => {
  it("normalizes company names", () => {
    expect(slugify("Acme GmbH!")).toBe("acme-gmbh");
    expect(slugify("  Über --- Company  ")).toBe("ber-company");
    expect(slugify("!!!")).toBe("company");
  });

  it("truncates long names and suffixes", () => {
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(48);
    expect(withSuffix("acme", 2)).toBe("acme-2");
  });
});

describe("login policy matrix", () => {
  const ok = {
    userFound: true,
    hasPassword: true,
    passwordOk: true,
    emailVerified: true,
    companyStatus: "ACTIVE" as const
  };

  it("happy path", () => {
    expect(evaluateLogin(ok)).toEqual({ ok: true });
  });

  it("unknown user / no password / wrong password are indistinguishable 401s", () => {
    const unknown = evaluateLogin({ ...ok, userFound: false, hasPassword: false, passwordOk: false });
    const noHash = evaluateLogin({ ...ok, hasPassword: false, passwordOk: false });
    const wrongPw = evaluateLogin({ ...ok, passwordOk: false });
    expect(unknown).toEqual(noHash);
    expect(noHash).toEqual(wrongPw);
    expect(wrongPw).toMatchObject({ ok: false, status: 401, code: "INVALID_CREDENTIALS" });
  });

  it("unverified email → 403 EMAIL_NOT_VERIFIED", () => {
    expect(evaluateLogin({ ...ok, emailVerified: false })).toMatchObject({
      ok: false,
      status: 403,
      code: "EMAIL_NOT_VERIFIED"
    });
  });

  it("suspended or pending company → generic 403 that does not disclose the reason", () => {
    const suspended = evaluateLogin({ ...ok, companyStatus: "SUSPENDED" });
    const pending = evaluateLogin({ ...ok, companyStatus: "PENDING_VERIFICATION" });
    expect(suspended).toMatchObject({ ok: false, status: 403, code: "ACCOUNT_UNAVAILABLE" });
    expect(suspended).toEqual(pending);
    if (!suspended.ok) {
      expect(suspended.message.toLowerCase()).not.toContain("suspend");
    }
  });
});
