export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Temporary API health check
    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        service: "dkf-backup",
        database: Boolean(env.DB)
      });
    }

    // Serve the existing static website
    return env.ASSETS.fetch(request);
  }
};
