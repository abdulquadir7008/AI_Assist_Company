import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { authenticate, HttpError } from "./http/auth.js";
import { adminRouter } from "./http/admin.js";
import { authLimiter, authRouter } from "./http/authRoutes.js";
import { rootRouter } from "./http/root.js";
import { seedRootAdmin } from "./http/rootSeed.js";
import { router } from "./http/routes.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// Self-authenticating surfaces mounted before the tenant auth gate:
// /api/auth handles registration/verification/login (rate-limited),
// /api/root guards itself with root-scoped tokens.
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/root", rootRouter);

// Every remaining /api route requires a tenant session except the health
// probe and the demo bootstrap endpoint (which 404s unless demo mode is on).
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

async function start() {
  await seedRootAdmin();
  app.listen(config.apiPort, () => {
    console.log(`RAG API listening on http://localhost:${config.apiPort}`);
  });
}

void start();
