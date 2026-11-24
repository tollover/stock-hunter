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
  if (!env.TEAM_DOMAIN || !env.JWKS_URL || !env.POLICY_AUD || !(env.ALLOWED_EMAILS || env.ALLOWED_EMAIL)) {
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
    const allowedEmails = String(env.ALLOWED_EMAILS || env.ALLOWED_EMAIL).split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (typeof payload.email !== "string" || !allowedEmails.includes(payload.email.toLowerCase())) {
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



    if (url.pathname === "/api/family/pending") {
      const email = String(auth.payload.email || "").trim().toLowerCase();
      try {
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS stock_hunter_family_invites (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, invited_email TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(owner_email, invited_email))").run();
        if (request.method === "GET") {
          const result = await env.DB.prepare("SELECT owner_email, status, created_at FROM stock_hunter_family_invites WHERE invited_email = ? AND status = 'pending' ORDER BY created_at DESC").bind(email).all();
          const total = await env.DB.prepare("SELECT COUNT(*) AS count FROM stock_hunter_family_invites WHERE status = 'pending'").first();
          return new Response(JSON.stringify({ ok: true, account_email: email, invites: result.results || [], pending_total: Number(total?.count || 0), matched_count: (result.results || []).length }), { status: 200, headers });
        }
        if (request.method === "POST") {
          const body = await request.json();
          const ownerEmail = String(body.owner_email || "").trim().toLowerCase();
          const invite = await env.DB.prepare("SELECT id FROM stock_hunter_family_invites WHERE owner_email = ? AND invited_email = ? AND status = 'pending'").bind(ownerEmail, email).first();
          if (!invite) return new Response(JSON.stringify({ ok: false, message: "このメールアドレス宛ての有効な招待がありません。" }), { status: 404, headers });
          await env.DB.prepare("UPDATE stock_hunter_family_invites SET status = 'accepted' WHERE owner_email = ? AND invited_email = ? AND status = 'pending'").bind(ownerEmail, email).run();
          return new Response(JSON.stringify({ ok: true, accepted: true }), { status: 200, headers });
        }
        return new Response(JSON.stringify({ ok: false, message: "Method not allowed." }), { status: 405, headers: { ...headers, allow: "GET, POST" } });
      } catch (error) {
        return new Response(JSON.stringify({ ok: false, message: "招待を確認できませんでした。" }), { status: 500, headers });
      }
    }

    if (url.pathname === "/api/family/invites") {
      const ownerEmail = String(env.ALLOWED_EMAIL || "").trim().toLowerCase();
      const requesterEmail = String(auth.payload.email || "").trim().toLowerCase();
      if (!ownerEmail || requesterEmail !== ownerEmail) {
        return new Response(JSON.stringify({ ok: false, message: "家族招待の管理は管理者アカウントのみ利用できます。" }), { status: 403, headers });
      }
      try {
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS stock_hunter_family_invites (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, invited_email TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(owner_email, invited_email))").run();
        if (request.method === "GET") {
          const result = await env.DB.prepare("SELECT id, invited_email, status, created_at FROM stock_hunter_family_invites WHERE owner_email = ? ORDER BY created_at DESC").bind(ownerEmail).all();
          return new Response(JSON.stringify({ ok: true, invites: result.results || [] }), { status: 200, headers });
        }
        if (request.method !== "POST") return new Response(JSON.stringify({ ok: false, message: "Method not allowed." }), { status: 405, headers: { ...headers, allow: "GET, POST" } });
        const body = await request.json();
        const invitedEmail = String(body.email || "").trim().toLowerCase();
        if (invitedEmail.length > 254 || !invitedEmail.includes("@") || !invitedEmail.includes(".")) return new Response(JSON.stringify({ ok: false, message: "メールアドレスの形式を確認してください。" }), { status: 400, headers });
        if (invitedEmail === ownerEmail) return new Response(JSON.stringify({ ok: false, message: "自分自身は招待できません。" }), { status: 400, headers });
        await env.DB.prepare("INSERT INTO stock_hunter_family_invites (id, owner_email, invited_email, status) VALUES (?, ?, ?, 'pending') ON CONFLICT(owner_email, invited_email) DO UPDATE SET status = 'pending', created_at = datetime('now')").bind(crypto.randomUUID(), ownerEmail, invitedEmail).run();
        return new Response(JSON.stringify({ ok: true, invited: true, email: invitedEmail, status: "pending" }), { status: 200, headers });
      } catch (error) {
        return new Response(JSON.stringify({ ok: false, message: "家族招待を保存できませんでした。" }), { status: 500, headers });
      }
    }

    if (url.pathname === "/api/sync") {
      if (request.method !== "GET" && request.method !== "PUT") {
        return new Response(JSON.stringify({ ok: false, message: "Method not allowed." }), {
          status: 405, headers: { ...headers, allow: "GET, PUT" }
        });
      }
      try {
        await env.DB.prepare("CREATE TABLE IF NOT EXISTS stock_hunter_sync (user_email TEXT PRIMARY KEY, data_json TEXT NOT NULL, safety_json TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
        const userEmail = String(auth.payload.email || "").trim().toLowerCase();
        const adminEmail = String(env.ALLOWED_EMAIL || "").trim().toLowerCase();
        const householdEmail = adminEmail;
        if (!adminEmail) return new Response(JSON.stringify({ ok: false, message: "管理者メールアドレスが設定されていません。" }), { status: 503, headers });
        if (userEmail !== adminEmail) {
          const membership = await env.DB.prepare("SELECT id FROM stock_hunter_family_invites WHERE owner_email = ? AND invited_email = ? AND status = 'accepted'").bind(adminEmail, userEmail).first();
          if (!membership) return new Response(JSON.stringify({ ok: false, message: "家族招待の承認が必要です。設定画面で招待を承認してください。" }), { status: 403, headers });
        }

        if (request.method === "GET") {
          const row = await env.DB.prepare("SELECT data_json, safety_json, updated_at FROM stock_hunter_sync WHERE user_email = ?").bind(householdEmail).first();
          return new Response(JSON.stringify({
            ok: true,
            exists: !!row,
            snapshot: row ? {
              data: JSON.parse(row.data_json),
              safety: row.safety_json ? JSON.parse(row.safety_json) : null,
              updated_at: row.updated_at
            } : null
          }), { status: 200, headers });
        }

        const raw = await request.text();
        if (new TextEncoder().encode(raw).length > 500000) {
          return new Response(JSON.stringify({ ok: false, message: "Backup exceeds the 500 KB limit." }), { status: 413, headers });
        }
        const body = JSON.parse(raw);
        if (!body || !body.data || !Array.isArray(body.data.products) ||
            !Array.isArray(body.data.purchases) ||
            (body.data.alerts !== undefined && !Array.isArray(body.data.alerts)) ||
            (body.data.keywordWatches !== undefined && !Array.isArray(body.data.keywordWatches)) ||
            (body.safety !== null && body.safety !== undefined &&
             (typeof body.safety !== "object" || Array.isArray(body.safety)))) {
          return new Response(JSON.stringify({ ok: false, message: "Backup format is invalid." }), { status: 400, headers });
        }

        await env.DB.prepare("INSERT INTO stock_hunter_sync (user_email, data_json, safety_json, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(user_email) DO UPDATE SET data_json = excluded.data_json, safety_json = excluded.safety_json, updated_at = datetime('now')")
          .bind(
            householdEmail,
            JSON.stringify({
              products: body.data.products,
              purchases: body.data.purchases,
              alerts: Array.isArray(body.data.alerts) ? body.data.alerts : [],
              keywordWatches: Array.isArray(body.data.keywordWatches) ? body.data.keywordWatches : []
            }),
            body.safety ? JSON.stringify(body.safety) : null
          ).run();

        return new Response(JSON.stringify({ ok: true, saved: true }), { status: 200, headers });
      } catch (error) {
        return new Response(JSON.stringify({ ok: false, message: "Cloud sync failed. Please try again." }), {
          status: 500, headers
        });
      }
    }

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
