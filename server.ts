import express from "express";
import { createServer as createViteServer } from "vite";
import { createApp, startPublishTimer } from "./api/index";

// Local dev / local-prod entry point. Not used on Vercel — see api/index.ts.
// (api/index.ts is the canonical source; importing from it here — rather than
// the other way around — keeps Vercel's Node function self-contained with no
// cross-directory relative imports, which its build previously failed to trace.)
async function startServer() {
  const app = createApp();
  const PORT = 3000;

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    startPublishTimer();
  });
}

startServer();
