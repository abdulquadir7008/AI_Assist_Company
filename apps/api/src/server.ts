import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { authenticate, HttpError } from "./http/auth.js";
import { adminRouter } from "./http/admin.js";
import { router } from "./http/routes.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// Every /api route is authenticated except the health probe and the demo
// bootstrap endpoint (which mints the demo personas).
const publicPaths = new Set(["/health", "/setup/demo"]);
app.use("/api", (request, response, next) => {
  if (publicPaths.has(request.path)) {
    next();
    return;
  }
  authenticate(request, response, next);
});

app.use("/api/admin", adminRouter);
app.use("/api", router);

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction
  ) => {
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    response.status(500).json({ error: message });
  }
);

app.listen(config.apiPort, () => {
  console.log(`RAG API listening on http://localhost:${config.apiPort}`);
});
