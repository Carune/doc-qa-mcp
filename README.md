# doc-qa-mcp

문서 질의응답 포트폴리오용 MCP 서버입니다.

현재 구조:

- 서버는 문서 인덱싱/검색/근거 반환 담당
- 최종 자연어 답변은 ChatGPT 같은 MCP 클라이언트가 담당

## 주요 도구

- `health_check`
- `index_documents`
- `list_sources`
- `search_chunks`
- `ask_with_citations`

## 실행 모드

### 1) stdio 모드 (기본)

로컬 Inspector 테스트용입니다.

`.env`:

```env
MCP_TRANSPORT=stdio
```

실행:

```bash
npm install
npm run build
npm run dev
```

### 2) HTTP 모드 (ChatGPT 연결용)

ChatGPT에 붙이려면 원격에서 접근 가능한 MCP URL이 필요합니다.

`.env`:

```env
MCP_TRANSPORT=http
MCP_HOST=0.0.0.0
MCP_PORT=3000
ENABLE_PGVECTOR=false
```

실행:

```bash
npm run dev
```

서버 엔드포인트:

- MCP: `http://localhost:3000/mcp`
- 헬스체크: `http://localhost:3000/healthz`

## ChatGPT 연결 절차

1. HTTP 모드로 서버 실행
2. 외부 공개 URL 확보 (예: Cloudflare Tunnel, ngrok)
   - 공개 URL이 `https://xxxx.example`면 MCP URL은 `https://xxxx.example/mcp`
3. ChatGPT에서 `Settings > Connectors > Create > Custom connector`로 이동
4. 위 MCP URL 등록

중요:

- ChatGPT는 로컬 MCP 서버(`localhost`)에 직접 연결할 수 없습니다.
- 반드시 인터넷에서 접근 가능한 원격 URL이어야 합니다.

## pgvector 모드 (선택)

의미 검색을 켜려면 임베딩 생성이 필요합니다.
현재 구현은 OpenAI 임베딩을 사용하므로 API 키가 있어야 합니다.

```env
ENABLE_PGVECTOR=true
DATABASE_URL=postgres://mcp:mcp@localhost:5432/mcp_doc_qa
OPENAI_API_KEY=...
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
VECTOR_DIMENSION=1536
```

Postgres(pgvector) 실행:

```bash
docker compose up -d
```

## 빠른 테스트 (Inspector)

1. `index_documents`

```json
{"paths":["docs/sample-api.md","docs/sample-oncall.md"]}
```

2. `search_chunks`

```json
{"query":"장애 발생 시 가장 먼저 무엇을 확인해야 해?"}
```

3. `ask_with_citations`

```json
{"question":"장애 대응 첫 단계가 뭐야?"}
```
