# 데모 스크립트 (3분)

## 1. 준비

```bash
npm install
npm run dev
```

접속:
- UI: `http://localhost:3000/`
- Health: `http://localhost:3000/healthz`

## 2. 시나리오 1: 기본 RAG 흐름

1. 샘플 문서 2개 인덱싱 (`docs/sample-api.md`, `docs/sample-oncall.md`)
2. 질문: `What should we check first during an incident?`
3. 확인 포인트:
- 답변 본문
- citation(소스/청크 인덱스)
- retrieval mode, latency

## 3. 시나리오 2: 구조 추출(테이블/목록)

1. 주간업무보고 스펙 문서를 `/api/index-text`로 인덱싱
2. 스트림 질문: `테이블 목록 알려줘`
3. 확인 포인트:
- `USER`, `CLIENT`, `PROJECT`, `WORK`, `PROGRESS`, `REPORT`, `KEYPOINT`, `공통` 포함 여부
- 스트리밍 경로에서도 구조 추출이 유지되는지

## 4. 시나리오 3: 검색 가시화

1. 먼저 `/api/search`로 검색 결과 확인
2. 같은 질문을 `/api/ask`로 실행
3. 설명 포인트:
- 검색 후보
- 재정렬 + 인접 청크 확장
- 최종 근거 기반 답변 연결

## 5. 마무리 (30초)

```bash
npm run eval
BENCH_QUESTION="테이블 목록 알려줘" npm run bench
```

지표 해설은 `docs/portfolio/overview.md` 기준으로 설명.
