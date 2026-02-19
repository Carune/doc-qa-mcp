# doc-qa-mcp

문서 질의응답 포트폴리오용 MCP 서버입니다.

초기에는 메모리 기반 키워드 검색 MVP로 시작했고, 현재는 아래 기능까지 포함합니다.

- `pgvector` 기반 의미 검색
- OpenAI 기반 근거 답변 생성(옵션)
- 답변별 출처(citation) 반환

## 아키텍처

1. `index_documents`
   - `.md` / `.txt` 파일 읽기
   - 문서를 청크 단위로 분할
   - (옵션) 청크 임베딩 생성
   - 소스/청크 저장
2. `search_chunks`
   - 메모리 모드: 토큰 겹침 기반 검색
   - pgvector 모드: 벡터 유사도 검색
3. `ask_with_citations`
   - 상위 청크 검색
   - 답변 + 출처 반환
   - OpenAI 키가 있으면 검색 컨텍스트 기반 모델 답변 생성

## 실행 (메모리 모드)

```bash
npm install
npm run build
npm run dev
```

메모리 모드는 별도 인프라가 필요 없습니다.

## 실행 (pgvector + 의미 검색 모드)

1. pgvector postgres 실행

```bash
docker compose up -d
```

2. `.env.example` 복사 후 `.env` 생성

```bash
cp .env.example .env
```

필수 값:

- `ENABLE_PGVECTOR=true`
- `DATABASE_URL=postgres://mcp:mcp@localhost:5432/mcp_doc_qa`
- `OPENAI_API_KEY=...`

3. 서버 실행

```bash
npm run dev
```

## MCP 도구 목록

- `health_check`
- `index_documents`
- `list_sources`
- `search_chunks`
- `ask_with_citations`

## 빠른 테스트 흐름 (MCP Inspector)

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
{"query":"장애 발생 시 가장 먼저 무엇을 확인해야 해?"}
```

4. `ask_with_citations`

```json
{"question":"장애 대응 첫 단계가 뭐야?"}
```

## 참고

- `migrations/001_init_pgvector.sql` 파일을 제공하지만,
  pgvector 모드에서는 서버 시작 시 extension/table/index를 자동 초기화합니다.
