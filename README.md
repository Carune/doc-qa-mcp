# doc-qa-mcp

로컬 문서 기반 질의응답을 위한 MCP/REST 서버입니다.  
문서를 청킹해 인덱싱하고, 검색 결과를 근거(citation)로 포함한 답변을 제공합니다.

## 1. 주요 기능

- MCP 도구
  - `health_check`
  - `index_documents`
  - `list_sources`
  - `search_chunks`
  - `ask_with_citations`
- REST API
  - `POST /api/index`
  - `POST /api/index-text`
  - `POST /api/index-upload`
  - `POST /api/index/reset`
  - `GET /api/index/storage`
  - `GET /api/sources`
  - `POST /api/search`
  - `POST /api/ask`
  - `POST /api/ask-stream`
  - `POST /api/summarize`
- 검색/답변 모드
  - 검색: `lexical`, `hybrid`(벡터 사용 시)
  - 답변: `client_llm`, `ollama`

## 2. 빠른 시작

```bash
npm install
npm run dev
```

기본 주소

- UI: `http://localhost:3000/`
- 헬스체크: `http://localhost:3000/healthz`
- MCP 엔드포인트: `http://localhost:3000/mcp`

## 3. 환경 변수

`.env.example`를 복사해 `.env`를 만드세요.

```env
MCP_TRANSPORT=http
MCP_HOST=0.0.0.0
MCP_PORT=3000

PERSIST_INMEMORY_INDEX=true
INMEMORY_INDEX_PATH=.data/inmemory-index.json
MAX_INMEMORY_INDEX_BYTES=20971520

ENABLE_PGVECTOR=false
DATABASE_URL=postgres://mcp:mcp@localhost:5432/mcp_doc_qa

OPENAI_API_KEY=
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

EMBEDDING_PROVIDER=none
ANSWER_MODE=client_llm
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=qwen2.5:7b-instruct
OLLAMA_EMBEDDING_MODEL=nomic-embed-text

VECTOR_DIMENSION=1536
```

권장 모드

- 로컬 완전형 RAG
  - `EMBEDDING_PROVIDER=ollama`
  - `ANSWER_MODE=ollama`
- 최소 구성(MVP)
  - `EMBEDDING_PROVIDER=none`
  - `ANSWER_MODE=client_llm`

## 4. Ollama 기반 실행

모델 준비

```bash
ollama pull qwen2.5:7b-instruct
ollama pull nomic-embed-text
```

서버 실행

```bash
npm run dev
```

## 5. 사용 순서

1. 문서 인덱싱
- 경로 인덱싱: `POST /api/index`
- 텍스트 인덱싱: `POST /api/index-text`
- 파일 업로드 인덱싱: `POST /api/index-upload`

2. 검색 확인
- `POST /api/search`

3. 질의응답
- 일반: `POST /api/ask`
- 스트리밍: `POST /api/ask-stream`
- 전체 요약: `POST /api/summarize`

4. 운영 확인
- 소스 목록: `GET /api/sources`
- 저장소 정보: `GET /api/index/storage`
- 인덱스 초기화: `POST /api/index/reset`

## 6. 테스트/평가/벤치

```bash
npm run test
npm run eval
BENCH_QUESTION="테이블 목록 알려줘" npm run bench
```

- `test`: 단위/통합 테스트
- `eval`: 간단 품질 지표 출력
- `bench`: API 지연/TTFT 벤치마크

## 7. 주의사항

- `lexical` 모드에서는 문서 언어와 질문 언어가 다르면 성능이 떨어질 수 있습니다.
- 구조 질의(테이블/메뉴/목록)는 결정적 추출 경로를 우선 사용합니다.
- 운영 환경에서는 `/api/index` 경로 입력에 대한 접근제어/allowlist 적용을 권장합니다.

## 8. ChatGPT 커넥터 연결

1. 서버 실행(`MCP_TRANSPORT=http`)
2. 공개 URL 준비(ngrok/Cloudflare Tunnel)
3. 커넥터에 `https://<public-url>/mcp` 등록

참고

- ChatGPT 구독과 OpenAI API 과금은 별개입니다.
- `ANSWER_MODE=client_llm`이면 클라이언트 LLM이 최종 문장을 만들고, `ANSWER_MODE=ollama`이면 서버가 최종 문장을 생성합니다.

## 9. 포트폴리오 자료

- 포트폴리오 요약(아키텍처/지표): `docs/portfolio/overview.md`
- 3분 데모 스크립트: `docs/portfolio/demo-script.md`
- 보안 및 운영 노트: `docs/portfolio/security-ops.md`
