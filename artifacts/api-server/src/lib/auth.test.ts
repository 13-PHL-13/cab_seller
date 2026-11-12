import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSessionCookie,
  createOpaqueToken,
  hashPassword,
  hashToken,
  sessionCookie,
  verifyPassword,
} from "./auth.ts";

test("password hashes are salted and verify only the matching password", async () => {
  const password = "Correct-Horse-Battery-2026!";
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.notEqual(first, second, "each password hash must use a unique salt");
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("not-the-password", first), false);
  assert.equal(await verifyPassword(password, second), true);
});

test("opaque session tokens have 256 bits of random material", () => {
  const first = createOpaqueToken();
  const second = createOpaqueToken();

  assert.equal(Buffer.from(first, "base64url").length, 32);
  assert.notEqual(first, second);
  assert.equal(hashToken(first).length, 64);
});

test("production cookies are host-only, secure and HttpOnly", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const cookie = sessionCookie("opaque-token", 3600);
    assert.match(cookie, /^__Host-session=opaque-token;/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.doesNotMatch(cookie, /Domain=/);
    assert.match(clearSessionCookie(), /^__Host-session=;/);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
