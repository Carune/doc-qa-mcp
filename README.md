# doc-qa-mcp

문서 질의응답 포트폴리오용 MCP 서버입니다.

핵심 방향:

- 서버는 문서 인덱싱/검색/근거 반환만 담당
- 최종 답변 생성은 ChatGPT 같은 MCP 클라이언트 LLM이 담당

즉, ChatGPT Pro 사용자라면 서버에서 별도 LLM API를 직접 호출하지 않아도 됩니다.

## 동작 구조

1. `index_documents`
   - `.md` / `.txt` 파일을 읽고 청크로 분할
   - 인덱스 저장
2. `search_chunks`
   - 관련 청크 검색
3. `ask_with_citations`
   - 답변 초안 + 출처(citation) 반환
   - 반환값의 `answer_generation_mode`는 항상 `client_llm`

## 실행 모드

### 1) 기본 모드 (권장, API 키 불필요)

- `ENABLE_PGVECTOR=false`
- 인메모리 키워드 검색
- ChatGPT가 도구 결과를 읽고 최종 답변 생성

```bash
npm install
npm run build
npm run dev
```

### 2) 의미 검색 모드 (선택)

- `ENABLE_PGVECTOR=true`
- `pgvector` + 임베딩 필요
- 이 경우 `OPENAI_API_KEY`가 필요합니다 (임베딩 생성용)

```bash
docker compose up -d
npm run dev
```

## 환경변수 (`.env`)

`.env.example`를 복사해 `.env`를 만드세요.

```bash
cp .env.example .env
```

기본값 예시:

```env
ENABLE_PGVECTOR=false
DATABASE_URL=postgres://mcp:mcp@localhost:5432/mcp_doc_qa
OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
VECTOR_DIMENSION=1536
```

참고:

- `.env`는 `.gitignore`에 포함되어 커밋되지 않습니다.
- 서버는 `dotenv`로 `.env`를 자동 로드합니다.

## MCP 도구 목록

- `health_check`
- `index_documents`
- `list_sources`
- `search_chunks`
- `ask_with_citations`

## 빠른 테스트 (MCP Inspector)

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
