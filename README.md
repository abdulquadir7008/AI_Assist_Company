# Private Company RAG Assistant

A private AI assistant for companies to upload internal documents and let employees ask grounded questions over HR policies, product docs, technical documentation, legal files, and training materials.

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

2. Fill in `OPENAI_API_KEY` or `HUGGINGFACE_API_KEY` in `.env`.

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

- Upload company documents by category and visibility.
- Extract document text, split it into searchable chunks, embed chunks, and store vectors in Chroma.
- Ask questions and receive answers grounded in retrieved internal context.
- Switch AI provider per question with `openai` or `huggingface`.

## Production Notes

This scaffold is intentionally tenant-aware at the data model level, but authentication is represented with headers for the first build slice:

- `x-company-id`
- `x-user-id`

Before production, add SSO/auth, role-based access control, background ingestion jobs, encryption-at-rest policies, audit retention, and admin document lifecycle workflows.
