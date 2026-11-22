export default {
  async fetch(request, env) {
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
          note: "Protect this Worker with Cloudflare Access before exposing private data APIs."
        }, null, 2), { status: 200, headers });
      } catch (error) {
        return new Response(JSON.stringify({
          ok: false,
          message: "D1 query failed.",
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