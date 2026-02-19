# doc-qa-mcp

문서 QA용 MCP 서버 포트폴리오 프로젝트입니다.  
로컬 문서(`.md`, `.txt`)를 인덱싱하고, 검색 결과와 출처(citation)를 기반으로 답변할 수 있습니다.

## 1. 현재 구현 범위

- MCP 도구 제공: `health_check`, `index_documents`, `list_sources`, `search_chunks`, `ask_with_citations`
- REST API 제공: `/api/index`, `/api/index-text`, `/api/sources`, `/api/search`, `/api/ask`
- 웹 데모 UI 제공: `GET /`
- 검색 모드
1. `lexical`(기본): 키워드 기반 검색
2. `semantic`: 임베딩 기반 검색
- 답변 모드
1. `client_llm`(기본): 서버는 근거/요약만 반환, 최종 자연어 생성은 클라이언트 LLM이 담당
2. `ollama`: 서버가 로컬 Ollama 모델로 최종 답변까지 생성

## 2. 빠른 시작

```bash
npm install
npm run dev
```

기본 접속:

- 데모 UI: `http://localhost:3000/`
- 헬스체크: `http://localhost:3000/healthz`
- MCP 엔드포인트: `http://localhost:3000/mcp`

## 3. 실행 모드 설정(.env)

`.env.example`을 복사해서 `.env`를 만든 뒤 사용하세요.

```env
MCP_TRANSPORT=http
MCP_HOST=0.0.0.0
MCP_PORT=3000

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

### 3-1. 추천 모드

- 완전 무료 로컬 데모(검색 + 서버 답변 생성)
1. `EMBEDDING_PROVIDER=ollama`
2. `ANSWER_MODE=ollama`

- 단순 MVP(검색만)
1. `EMBEDDING_PROVIDER=none`
2. `ANSWER_MODE=client_llm`

## 4. Ollama 기반 "진짜 RAG" 실행

### 4-1. Ollama 모델 준비

```bash
ollama pull qwen2.5:7b-instruct
ollama pull nomic-embed-text
```

### 4-2. .env 설정

```env
EMBEDDING_PROVIDER=ollama
ANSWER_MODE=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_CHAT_MODEL=qwen2.5:7b-instruct
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

### 4-3. 서버 실행

```bash
npm run dev
```

## 5. 사용 순서(의도한 동작 흐름)

1. 문서 인덱싱
- 파일 경로 인덱싱: `/api/index`
- 파일 업로드 인덱싱: `/api/index-text`

2. 검색 확인
- `/api/search` 또는 `search_chunks`로 근거 청크 확인

3. 질의 응답
- `/api/ask` 또는 `ask_with_citations`
- 반환값의 `answer_generation_mode` 확인
1. `client_llm`: 서버는 근거 기반 요약까지
2. `ollama`: 서버가 최종 답변까지 생성

## 6. 다국어 관련 주의사항

- `lexical` 모드에서는 문서 언어와 질문 언어가 같아야 검색 정확도가 높습니다.
- 다국어(예: 스페인어 문서 + 한국어 질문)를 원하면 `EMBEDDING_PROVIDER=ollama` 또는 OpenAI 임베딩 기반의 `semantic` 모드를 사용하세요.

## 7. 테스트/평가

```bash
npm run test
npm run eval
```

- `test`: 단위/통합 테스트
- `eval`: 샘플 질문셋 기준 간단 지표 출력(`top_citation_hit_rate`, `keyword_hit_rate`, `avg_latency_ms`)

## 8. ChatGPT 커넥터 연결

1. 서버 실행(`MCP_TRANSPORT=http`)
2. 외부 공개 URL 확보(Cloudflare Tunnel 또는 ngrok)
3. ChatGPT 앱 커넥터에 `https://<public-url>/mcp` 등록

주의:

- ChatGPT Pro 구독과 OpenAI API 과금은 별개입니다.
- `ANSWER_MODE=client_llm`이면 ChatGPT가 최종 문장을 만들고, `ANSWER_MODE=ollama`이면 서버가 최종 문장을 만듭니다.
