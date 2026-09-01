import express from "express";
import { createServer as createViteServer } from "vite";
import { createApp, startPublishTimer } from "./lib/app";

// Local dev / local-prod entry point. Not used on Vercel — see api/index.ts.
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
