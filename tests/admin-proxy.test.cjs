const test = require("node:test");
const assert = require("node:assert/strict");
const { isAllowedPath } = require("../functions/paths");
const { resolveAllowedOrigin } = require("../functions/cors");

test("il proxy accetta solo i percorsi del worker", () => {
  assert.equal(isAllowedPath("/users/list"), true);
  assert.equal(isAllowedPath("/users/reset-password"), true);
  assert.equal(isAllowedPath("/password"), true);
  assert.equal(isAllowedPath("/users/reset-store-passwords"), true);
  assert.equal(isAllowedPath("/etc/passwd"), false);
  assert.equal(isAllowedPath("https://example.invalid/users/list"), false);
  assert.equal(isAllowedPath("/users/list?x=1"), false);
});

test("un'origine https diversa da GitHub Pages non diventa Failed to fetch", () => {
  const env = { ALLOWED_ORIGIN: "https://mbrp95.github.io" };
  assert.equal(resolveAllowedOrigin("https://mbrp95.github.io", env), "https://mbrp95.github.io");
  assert.equal(resolveAllowedOrigin("https://vpn-gateway.example", env), "https://vpn-gateway.example");
  assert.equal(resolveAllowedOrigin("http://intranet.local", env), "https://mbrp95.github.io");
  assert.equal(resolveAllowedOrigin("", env), "https://mbrp95.github.io");
});
