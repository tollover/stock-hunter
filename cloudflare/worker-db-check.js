let cachedJwks = null;
let cachedJwksUntil = 0;

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

async function getJwks(url) {
  if (cachedJwks && Date.now() < cachedJwksUntil) return cachedJwks;

  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Access signing keys could not be loaded.");

  const data = await response.json();
  if (!data || !Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error("Access signing keys response was invalid.");
  }

  cachedJwks = data.keys;
  cachedJwksUntil = Date.now() + 5 * 60 * 1000;
  return cachedJwks;
}

async function verifyAccessRequest(request, env) {
  if (!env.TEAM_DOMAIN || !env.JWKS_URL || !env.POLICY_AUD || !env.ALLOWED_EMAIL) {
    return { ok: false, status: 503, message: "Access verification is not configured." };
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    return { ok: false, status: 401, message: "Cloudflare Access login is required." };
  }

  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Malformed token.");

    const header = decodeJsonPart(parts[0]);
    const payload = decodeJsonPart(parts[1]);

    if (header.alg !== "RS256" || typeof header.kid !== "string") {
      throw new Error("Unsupported token algorithm.");
    }
    if (payload.iss !== env.TEAM_DOMAIN) throw new Error("Invalid token issuer.");

    const audience = payload.aud;
    const hasAudience = Array.isArray(audience)
      ? audience.includes(env.POLICY_AUD)
      : audience === env.POLICY_AUD;
    if (!hasAudience) throw new Error("Invalid token audience.");

    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(payload.exp) || now >= payload.exp) {
      throw new Error("Token has expired or has no expiry.");
    }
    if (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || now < payload.nbf)) {
      throw new Error("Token is not active yet.");
    }
    if (payload.email !== env.ALLOWED_EMAIL) {
      throw new Error("This account is not allowed.");
    }

    const keys = await getJwks(env.JWKS_URL);
    const jwk = keys.find((key) =>
      key.kid === header.kid &&
      key.kty === "RSA" &&
      (!key.alg || key.alg === "RS256") &&
      (!key.use || key.use === "sig")
    );
    if (!jwk) throw new Error("A matching Access signing key was not found.");

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const validSignature = await crypto.subtle.verify(
      { name: "RSASSA-PKCS1-v1_5" },
      publicKey,
      decodeBase64Url(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    if (!validSignature) throw new Error("Invalid token signature.");

    return { ok: true, payload };
  } catch (error) {
    return {
      ok: false,
      status: 403,
      message: "Cloudflare Access verification failed."
    };
  }
}

export default {
  async fetch(request, env) {
    const auth = await verifyAccessRequest(request, env);
    if (!auth.ok) {
      return new Response(JSON.stringify({
        ok: false,
        message: auth.message
      }), {
        status: auth.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    }

    const headers = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    };
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({
          ok: false,
          message: "Only GET requests are allowed."
        }), { status: 405, headers });
      }

      try {
        const database = await env.DB.prepare("SELECT 1 AS connected").first();
        return new Response(JSON.stringify({
          ok: true,
          database_connected: database?.connected === 1,
          access_verified: true
        }, null, 2), { status: 200, headers });
      } catch (error) {
        return new Response(JSON.stringify({
          ok: false,
          message: "D1 query failed.",
          error: String(error && error.message ? error.message : error)
        }), { status: 500, headers });
      }
    }

    if (url.pathname === "/db-test") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({
          ok: false,
          message: "Only GET requests are allowed."
        }, null, 2), { status: 405, headers });
      }
      try {
        const row = await env.DB.prepare(
          "SELECT id, message, created_at FROM stock_hunter_test ORDER BY id DESC LIMIT 1"
        ).first();
        return new Response(JSON.stringify({
          ok: true,
          message: "Worker successfully read from the D1 test table.",
          test_row: row,
          access_verified: true
        }, null, 2), { status: 200, headers });
      } catch (error) {
        return new Response(JSON.stringify({
          ok: false,
          message: "D1 query failed.",
          error: String(error && error.message ? error.message : error)
        }, null, 500), { status: 500, headers });
      }
    }

    if (!env.ASSETS) {
      return new Response("Static assets are not configured.", { status: 500 });
    }
    return env.ASSETS.fetch(request);
  }
};
