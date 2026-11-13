const { onRequest } = require("firebase-functions/v2/https");
const { isAllowedPath } = require("./paths");

const UPSTREAM = "https://device-proposer-admin.mariab-ragucci.workers.dev";
const WORKER_ORIGIN = "https://mbrp95.github.io";

function corsHeaders(origin) {
  const allow = /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(origin || "")
    ? origin
    : WORKER_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

// Il browser parla solo con Firebase. Questa funzione inoltra la richiesta
// al worker già pubblicato e gli presenta l'origine che quel worker accetta.
exports.adminApi = onRequest(
  { region: "europe-west1", cors: false, invoker: "public", memory: "256MiB", timeoutSeconds: 30 },
  async (req, res) => {
    const origin = req.get("origin") || "";
    res.set(corsHeaders(origin));
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ success: false, error: "Metodo non supportato." });
      return;
    }
    const path = String(req.query.path || "");
    if (!isAllowedPath(path)) {
      res.status(404).json({ success: false, error: "Endpoint non trovato." });
      return;
    }
    const authorization = req.get("authorization") || "";
    if (!authorization.startsWith("Bearer ") || authorization.length < 20) {
      res.status(401).json({ success: false, error: "Autenticazione richiesta." });
      return;
    }
    let upstream;
    try {
      upstream = await fetch(UPSTREAM + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
          Origin: WORKER_ORIGIN
        },
        body: JSON.stringify(req.body ?? {})
      });
    } catch (e) {
      res.status(502).json({ success: false, error: "Il servizio credenziali non è raggiungibile." });
      return;
    }
    const text = await upstream.text();
    res.status(upstream.status).type("application/json; charset=utf-8").send(text);
  }
);
