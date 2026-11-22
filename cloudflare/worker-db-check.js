export default {
  async fetch(request, env, ctx) {
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

      if (!ctx.access) {
        return new Response(JSON.stringify({
          ok: false,
          message: "Cloudflare Access authentication is required."
        }), { status: 401, headers });
      }

      try {
        const identity = await ctx.access.getIdentity();
        if (!identity || !identity.email) {
          return new Response(JSON.stringify({
            ok: false,
            message: "Authenticated identity could not be verified."
          }), { status: 401, headers });
        }

        const database = await env.DB.prepare("SELECT 1 AS connected").first();
        return new Response(JSON.stringify({
          ok: true,
          authenticated: true,
          database_connected: database?.connected === 1
        }, null, 2), { status: 200, headers });
      } catch (error) {
        return new Response(JSON.stringify({
          ok: false,
          message: "Authentication or database check failed.",
          error: String(error && error.message ? error.message : error)
        }, null, 500), { status: 500, headers });
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
          test_row: row
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