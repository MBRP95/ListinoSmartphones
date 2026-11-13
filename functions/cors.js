// Il worker in produzione accetta una sola origine (GitHub Pages).
// Sotto VPN il browser può presentarsi con un'altra origine https, oppure
// non raggiungere affatto *.workers.dev. In entrambi i casi il browser
// mostra solo "Failed to fetch".
function resolveAllowedOrigin(origin, env) {
  const configured = String((env && env.ALLOWED_ORIGIN) || "*")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const requestOrigin = String(origin || "");
  if (configured.includes("*")) {
    return /^https:\/\//i.test(requestOrigin) ? requestOrigin : "*";
  }
  if (requestOrigin && configured.includes(requestOrigin)) return requestOrigin;
  if (/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(requestOrigin)) return requestOrigin;
  return configured[0] || "*";
}

module.exports = { resolveAllowedOrigin };
