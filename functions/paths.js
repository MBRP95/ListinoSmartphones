// Percorsi che il browser può chiedere al worker attraverso il proxy.
// Il worker resta l'unico componente che cambia le password.
const ALLOWED_PATHS = new Set([
  "/client/access",
  "/shop/pin/set",
  "/shop/pin/disable",
  "/images/upload",
  "/users/me",
  "/verify-admin",
  "/password",
  "/users/list",
  "/users/create",
  "/users/delete",
  "/users/reset-password",
  "/users/reset-store-passwords",
  "/password/change"
]);

function isAllowedPath(path) {
  return ALLOWED_PATHS.has(String(path || ""));
}

module.exports = { ALLOWED_PATHS, isAllowedPath };
