export default {
  async fetch(request, env) {
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    };

    if (!env.DB) {
      return new Response(JSON.stringify({
        ok: false,
        message: "D1 binding DB is not available."
      }, null, 2), { status: 500, headers });
    }

    try {
      const result = await env.DB.prepare("SELECT 1 AS connected").first();

      return new Response(JSON.stringify({
        ok: true,
        message: "Worker can connect to D1.",
        database_test: result
      }, null, 2), { status: 200, headers });
    } catch (error) {
      return new Response(JSON.stringify({
        ok: false,
        message: "D1 connection test failed.",
        error: String(error && error.message ? error.message : error)
      }, null, 2), { status: 500, headers });
    }
  }
};
