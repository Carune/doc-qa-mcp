# MCP Doc QA

MCP(Model Context Protocol) 기반 문서 질의응답 서버를 단계적으로 만드는 프로젝트입니다.

## Step 1 목표

- MCP 서버를 표준 입출력(stdio)으로 실행한다.
- `health_check` 도구 1개를 등록해 호출 흐름을 이해한다.

## Step 2 목표

- 로컬 문서를 인덱싱한다.
- 인덱싱한 문서를 검색한다.
- 소스 목록을 확인한다.

## MCP 서버란?

- 클라이언트(예: MCP 지원 에이전트)가 호출할 수 있는 "도구(tool)"를 제공하는 서버다.
- 각 도구는 입력 스키마와 출력 형식을 가진다.
- 이 프로젝트는 나중에 문서 인덱싱/검색/근거기반 답변 도구를 추가할 예정이다.

## 실행

```bash
npm install
npm run build
npm start
```

개발 실행:

```bash
npm run dev
```

## 현재 제공 도구

- `health_check`: 서버가 정상 실행 중인지 확인
- `index_documents`: `.md`, `.txt` 파일 인덱싱
- `list_sources`: 인덱싱된 소스 목록 반환
- `search_chunks`: 질문과 유사한 문단 검색

## Step 2 동작 요약

1. `index_documents`가 파일을 읽고 문단 기준으로 청크를 만든다.
2. 청크를 메모리 저장소에 저장한다.
3. `search_chunks`는 토큰 겹침 점수로 상위 청크를 반환한다.

현재는 빠른 MVP를 위해 메모리 저장소를 사용한다. 서버 재시작 시 인덱스는 사라진다.
