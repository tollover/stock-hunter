export default {
  async fetch(request, env) {
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    };

    if (request.method !== "GET") {
      return new Response(JSON.stringify({
        ok: false,
        message: "Only GET requests are allowed."
      }, null, 2), { status: 405, headers });
    }

    if (!env.DB) {
      return new Response(JSON.stringify({
        ok: false,
        message: "D1 binding DB is not available."
      }, null, 2), { status: 500, headers });
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/db-test") {
        const row = await env.DB.prepare(
          "SELECT id, message, created_at FROM stock_hunter_test ORDER BY id DESC LIMIT 1"
        ).first();

        return new Response(JSON.stringify({
          ok: true,
          message: "Worker successfully read from the D1 test table.",
          test_row: row
        }, null, 2), { status: 200, headers });
      }

      const result = await env.DB.prepare("SELECT 1 AS connected").first();

      return new Response(JSON.stringify({
        ok: true,
        message: "Worker can connect to D1.",
        database_test: result,
        next_step: "Open /db-test to verify a read from the test table."
      }, null, 2), { status: 200, headers });
    } catch (error) {
      return new Response(JSON.stringify({
        ok: false,
        message: "D1 query failed.",
        error: String(error && error.message ? error.message : error)
      }, null, 500), { status: 500, headers });
    }
  }
};
