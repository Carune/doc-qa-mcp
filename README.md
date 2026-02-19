# doc-qa-mcp

문서 QA용 MCP 서버입니다.  
현재는 MCP 도구뿐 아니라 REST API도 함께 제공해서, ChatGPT 없이도 독립 실행할 수 있습니다.

## 핵심 기능

- 로컬 문서 인덱싱: `.md`, `.txt`
- 검색: lexical(기본) / semantic(pgvector+임베딩)
- 근거 기반 답변 초안 + citations
- MCP 도구 + REST API 동시 제공

## 실행 모드

### 1) 기본 모드 (무과금, 권장 시작점)

`.env`:

```env
MCP_TRANSPORT=http
MCP_HOST=0.0.0.0
MCP_PORT=3000
ENABLE_PGVECTOR=false
OPENAI_API_KEY=
```

실행:

```bash
npm install
npm run build
npm run dev
```

확인:

```bash
curl http://localhost:3000/healthz
```

### 2) semantic 검색 모드 (선택)

`pgvector` + 임베딩을 사용합니다.

```env
ENABLE_PGVECTOR=true
DATABASE_URL=postgres://mcp:mcp@localhost:5432/mcp_doc_qa
OPENAI_API_KEY=...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
VECTOR_DIMENSION=1536
```

```bash
docker compose up -d
npm run dev
```

## MCP 도구

- `health_check`
- `index_documents`
- `list_sources`
- `search_chunks`
- `ask_with_citations`

## REST API (독립 실행 데모용)

### 인덱싱

`POST /api/index`

```json
{
  "paths": ["docs/sample-api.md", "docs/sample-oncall.md"]
}
```

### 소스 조회

`GET /api/sources`

### 검색

`POST /api/search`

```json
{
  "query": "장애 발생 시 무엇을 먼저 확인해?"
}
```

### 질문

`POST /api/ask`

```json
{
  "question": "장애 대응 첫 단계가 뭐야?"
}
```

## ChatGPT 연결

1. 서버 실행 (`MCP_TRANSPORT=http`)
2. Cloudflare Tunnel 또는 ngrok로 외부 URL 확보
3. ChatGPT 커넥터에 `https://<public-url>/mcp` 등록

주의:

- `localhost`는 ChatGPT에서 직접 접근할 수 없습니다.
- 터널 프로세스가 살아 있어야 연결이 유지됩니다.

## 포트폴리오 로드맵

다음 단계는 `docs/portfolio-roadmap.md`를 참고하세요.
