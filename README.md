# Private Company RAG Assistant

A private AI assistant for companies to upload internal documents and let employees ask grounded questions over HR policies, product docs, technical documentation, legal files, and training materials.

## Authentication & Company Onboarding

Real password-based auth with email verification — the header-based demo identity is gone.

- **Self-service registration** at `/register`: a company signs up with a name + admin account, receives a 6-digit verification code by email (15-minute expiry), and the registering user becomes the workspace `ADMIN`. With no SMTP configured, codes are returned in the API response and logged to the console (dev mode).
- **JWT sessions**: `POST /api/auth/login` returns a signed token (`JWT_SECRET`, 7-day expiry). The token carries identity only — roles, department, and company status are re-resolved from Postgres on **every** request, so role changes and suspensions apply immediately (a suspended company's existing tokens stop working on the next request).
- **Admin-created teammates**: admins add users from `/admin` with a generated temporary password; the account is pre-verified and forced through a password change on first sign-in.
- **Brute-force protection**: bcrypt password hashing, rate-limited auth endpoints, and constant-shape login errors (no user enumeration).
- **Root admin** (optional, `/root`): a platform-level operator seeded from `ROOT_ADMIN_EMAIL`/`ROOT_ADMIN_PASSWORD` who can list companies, suspend/activate them, and manually verify users. Root tokens are a separate scope — they are rejected by every tenant endpoint, and the root API has no routes that touch documents, questions, or vectors, so tenant content is isolated from the platform operator by construction.
- **Demo mode** (`ENABLE_DEMO_SETUP=true`): seeds 5 personas (`admin@`/`hr@`/`legal@`/`employee@`/`contractor@demo-company.test`, password `demo-password`) for trying the RBAC behavior. Set to `false` in production to remove the seed endpoint and login hints.

## Role-Based Access Control

Access control is enforced **at the retrieval layer**, not the UI. Every chunk carries ACL flags in the vector store, and the requester's permissions are compiled into the Chroma `where` filter that runs inside the similarity search — content a user isn't allowed to see is never retrieved, scored, or passed to the LLM. Key properties:

- **Roles + departments, additive union.** Users hold one or more roles (`ADMIN`, `HR`, `LEGAL`, `MANAGER`, `EMPLOYEE`, `CONTRACTOR`) plus a department; documents declare allowed roles/departments. Access is granted if *any* role or the department matches. Admins see everything.
- **Fail closed.** Documents uploaded without explicit access rules are admin-only until classified. Pre-RBAC chunks (no ACL flags) are invisible to non-admins automatically.
- **Non-disclosure.** When the only relevant content is restricted, the answer is byte-identical to "no documents cover this" — restricted content's existence is never revealed. Unauthorized file downloads return 404, not 403.
- **Server-side permission resolution.** Roles are loaded from Postgres on every request (never trusted from the client), so promotions/terminations apply on the very next request.
- **Chunk-level overrides** for mixed-sensitivity documents (e.g., a handbook with a confidential appendix) via the admin API.
- **Admin controls** at `/admin`: user role/department management, document (bulk) reclassification — which rewrites vector-store metadata without re-embedding — an access matrix computed from the same predicate retrieval enforces, and a full audit log (every query records the requester's roles and exactly which chunks were retrieved and cited).

## Assistant Features

More than a search bar — the chat behaves like a real assistant:

- **Multi-turn conversations.** Chats are saved per user and follow-ups keep their context: "what about for remote employees?" is rewritten by a condense step into a standalone retrieval query using the conversation history, then answered with the history in the prompt. Conversations are strictly private to their owner — even admins cannot read another user's chat.
- **Document upload via chat.** Drag a file into the chat (or use the paperclip) and ask about it immediately. Chat uploads are **private to the uploader**: a dedicated owner lane in the ACL (enforced inside the vector-search filter, like all access rules) means only the uploader and admins can retrieve or even see the document until an admin reclassifies it from the admin page.
- **Proactive digests.** Every Monday morning (plus an admin "Send now" button) users get a "N policies changed this week" email listing new/reclassified documents — filtered per recipient with the same access predicate, so nobody is told about a document they can't read; users with no relevant changes get no email. An optional per-company Slack webhook posts a company-wide summary that only ever includes broadly-visible documents.
- **Suggested questions.** Empty chats show clickable suggestions: the most popular grounded questions asked in your department in the last 30 days — shown only if every document those answers cited is accessible to *you* (restricted topics never leak through popularity) — topped up with curated per-department starters.

## Source Citations

Every answer is traceable back to its source. Documents are chunked with metadata (document name, section/heading, page number, upload date) stored alongside each vector. Answers cite sources with inline `[1]`-style markers, and the API returns a structured `sources` array mapping each marker to its document, section, and page. The chat UI renders clickable citation chips, a per-answer Sources panel grouped by document with download links, and a `⚠` staleness flag for documents not updated in over 12 months. If the retrieved context can't support an answer, the assistant says so instead of guessing (`grounded: false`, no fabricated citations).

## Stack

- Frontend: Next.js + Tailwind CSS
- Backend: Node.js + Express
- AI providers: OpenAI or Hugging Face
- Vector database: Chroma
- Database: PostgreSQL + Prisma

## Quick Start (everything in Docker)

1. Copy environment variables:

```bash
cp .env.example .env
```

2. Fill in `OPENAI_API_KEY` or `HUGGINGFACE_API_KEY` in `.env`, and set `JWT_SECRET` (generate one with `openssl rand -hex 32`). Optionally set `ROOT_ADMIN_EMAIL`/`ROOT_ADMIN_PASSWORD` to enable the `/root` platform dashboard, and SMTP variables to send real verification emails (otherwise codes are logged/dev-returned).

3. Build and start the full stack (Postgres, Chroma, API, web):

```bash
docker compose up -d --build
```

The web app runs on `http://localhost:3000` and the API on `http://localhost:4000`. Database migrations are applied automatically when the API container starts.

## Local Development (infrastructure in Docker, apps on host)

1. Start only the infrastructure:

```bash
docker compose up -d postgres chroma
```

2. Install dependencies:

```bash
npm install
```

3. Prepare the database:

```bash
npm run prisma:generate
npm run prisma:migrate
```

4. Run the app:

```bash
npm run dev
```

The web app runs on `http://localhost:3000` and the API runs on `http://localhost:4000`.

## Core Flows

- Register a company at `/register`, verify by email code, and sign in — or seed the demo workspace from the login page.
- Upload company documents by category with role/department access rules.
- Extract document text, split it into searchable chunks, embed chunks, and store vectors in Chroma.
- Ask questions and receive answers grounded in retrieved internal context.
- Trace every answer to its sources: inline `[n]` citations, section/page metadata, document download, and stale-document warnings.
- Ask with the default Hugging Face model, or switch to OpenAI by entering your own API key (validated with a test call, kept in your browser only, sent per request, never stored server-side; a rejected key re-prompts and re-runs your question). Retrieval always embeds with the server's indexing provider so vector search stays consistent regardless of the answering model.

## Production Notes

Authentication (JWT + email verification), RBAC, and audit logging are implemented. Before production, additionally consider: SSO/SAML federation (swap the `authenticate` middleware in `apps/api/src/http/auth.ts` — it is the single seam), refresh-token rotation/revocation lists, background ingestion jobs, encryption-at-rest policies, audit retention, and admin document lifecycle workflows. Set `ENABLE_DEMO_SETUP=false` and use a strong unique `JWT_SECRET`.
