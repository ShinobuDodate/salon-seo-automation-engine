import express from "express";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use((err: any, req: any, res: any, next: any) => {
    if (err) {
      console.error("Express middleware error:", err);
      return res.status(err.status || 500).json({ 
        message: "Server middleware error", 
        error: err.message 
      });
    }
    next();
  });

  // WordPress Proxy Endpoint
  app.post("/api/wp-proxy", async (req, res) => {
    const { url, method, headers, body, isBase64 } = req.body;

    if (!url) {
      return res.status(400).json({ message: "URL is required" });
    }

    try {
      console.log(`Proxying ${method} request to: ${url}`);
      
      const fetchOptions: any = {
        method: method || 'GET',
        headers: {
          ...headers,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      };

      if (method !== 'GET' && body) {
        if (isBase64) {
          fetchOptions.body = Buffer.from(body, 'base64');
        } else {
          fetchOptions.body = typeof body === 'object' ? JSON.stringify(body) : body;
        }
      }

      const response = await fetch(url, fetchOptions);
      const contentType = response.headers.get('content-type');
      
      let data;
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      res.status(response.status).json(data);
    } catch (error: any) {
      console.error("Proxy error:", error);
      res.status(500).json({ 
        message: "Proxy server error", 
        error: error.message,
        code: error.code
      });
    }
  });

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
  });
}

startServer();
