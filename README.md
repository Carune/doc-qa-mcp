# doc-qa-mcp

문서 QA용 MCP 서버입니다.  
이 프로젝트는 **MCP 도구 + REST API + 간단 웹 UI**를 함께 제공해서, ChatGPT 없이도 독립 실행이 가능합니다.

## 현재 기능

- 로컬 문서 인덱싱 (`.md`, `.txt`)
- 검색 (`lexical` 기본, `semantic` 선택)
- 근거 문단(citations) 포함 답변 초안 생성
- MCP 엔드포인트(`/mcp`) 제공
- REST API(`/api/*`) 제공
- 데모 UI(`/`) 제공

## 빠른 시작 (기본 모드)

`.env` 예시:

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

브라우저 데모:

```text
http://localhost:3000/
```

언어 주의:

- 기본(lexical) 모드에서는 문서 언어와 질문 언어가 같아야 검색 정확도가 높습니다.
- 예: 영문 문서를 인덱싱했으면 영문 질문이 유리합니다.
- 한글 질문도 가능하지만, 교차언어 검색은 semantic 모드에서 더 잘 동작합니다.

## REST API

- `POST /api/index`
- `GET /api/sources`
- `POST /api/search`
- `POST /api/ask`

예시:

```json
{
  "paths": ["docs/sample-api.md", "docs/sample-oncall.md"]
}
```

## MCP 도구

- `health_check`
- `index_documents`
- `list_sources`
- `search_chunks`
- `ask_with_citations`

## ChatGPT 연결

1. 서버 실행 (`MCP_TRANSPORT=http`)
2. Cloudflare Tunnel 또는 ngrok로 외부 URL 확보
3. ChatGPT 커넥터에 `https://<public-url>/mcp` 등록

주의:

- `localhost`는 ChatGPT에서 직접 접근할 수 없습니다.

## 테스트

```bash
npm run test
```

포함:

- 서비스 레이어 테스트 (`tests/documentQaService.test.ts`)
- HTTP API 통합 테스트 (`tests/httpApi.integration.test.ts`)

## 평가 스크립트

```bash
npm run eval
```

질문셋(`eval/questions.json`) 기준으로 다음 지표를 출력합니다.

- `top_citation_hit_rate`
- `keyword_hit_rate`
- `avg_latency_ms`

## Semantic 검색(선택)

pgvector + OpenAI 임베딩을 사용할 때:

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

## 로드맵

다음 단계는 `docs/portfolio-roadmap.md` 참고.
