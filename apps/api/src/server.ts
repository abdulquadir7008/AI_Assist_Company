import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { router } from "./http/routes.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use("/api", router);

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction
  ) => {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    response.status(500).json({ error: message });
  }
);

app.listen(config.apiPort, () => {
  console.log(`RAG API listening on http://localhost:${config.apiPort}`);
});
