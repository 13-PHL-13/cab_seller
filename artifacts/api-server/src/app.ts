import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(pinoHttp({
  logger,
  serializers: {
    req(req) {
      return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
}));
app.disable("x-powered-by");
app.use('/api/tasks', express.json({ limit: '3mb' }));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true, limit: "32kb" }));
app.use("/api", router);

// In the Render container the Vite build is placed next to the API artifact.
// Keep this conditional so local development can still use Vite's dev server.
const webRoot = fileURLToPath(new URL("../../marketplace-cabinet/dist/public/", import.meta.url));
if (existsSync(webRoot)) {
  app.use(express.static(webRoot, { index: false }));
  app.use((req, res, next) => {
    if ((req.method === "GET" || req.method === "HEAD") && req.path !== "/api" && !req.path.startsWith("/api/")) {
      res.sendFile(path.join(webRoot, "index.html"), (error) => {
        if (error) next(error);
      });
      return;
    }
    next();
  });
}

app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (error && typeof error === 'object' && 'status' in error && error.status === 413) {
    res.status(413).json({ error: 'Снимок блока слишком большой. Сверните лишнюю детализацию и повторите.' }); return;
  }
  logger.error({ err: error, requestId: req.id }, "Unhandled API request error");
  res.status(500).json({ error: "Внутренняя ошибка сервера. Попробуйте позже." });
});

export default app;
