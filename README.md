# doc-qa-mcp

A portfolio MCP server for document QA.

It started as an in-memory keyword search MVP, and now supports:

- semantic retrieval with `pgvector`
- grounded QA with OpenAI (optional)
- citation output for every answer

## Architecture

1. `index_documents`
   - reads `.md` / `.txt`
   - splits content into chunks
   - (optional) generates embeddings
   - stores source + chunks
2. `search_chunks`
   - in-memory mode: lexical overlap search
   - pgvector mode: vector similarity search
3. `ask_with_citations`
   - retrieves top chunks
   - returns answer + citations
   - if OpenAI key exists, answer is model-generated from retrieved context

## Run (in-memory mode)

```bash
npm install
npm run build
npm run dev
```

No extra infra is required in this mode.

## Run (pgvector + semantic mode)

1. Start postgres with pgvector:

```bash
docker compose up -d
```

2. Create `.env` from `.env.example` and set your key:

```bash
cp .env.example .env
```

Required values:

- `ENABLE_PGVECTOR=true`
- `DATABASE_URL=postgres://mcp:mcp@localhost:5432/mcp_doc_qa`
- `OPENAI_API_KEY=...`

3. Run server:

```bash
npm run dev
```

## MCP tools

- `health_check`
- `index_documents`
- `list_sources`
- `search_chunks`
- `ask_with_citations`

## Quick test flow (MCP Inspector)

1. `index_documents`

```json
{"paths":["docs/sample-api.md","docs/sample-oncall.md"]}
```

2. `list_sources`

```json
{}
```

3. `search_chunks`

```json
{"query":"What should we check first during an incident?"}
```

4. `ask_with_citations`

```json
{"question":"What is the first incident response step?"}
```

## Notes

- `migrations/001_init_pgvector.sql` is provided for reference.
- The app also auto-initializes extension/tables/indexes in pgvector mode.
