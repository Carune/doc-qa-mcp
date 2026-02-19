# Portfolio Roadmap (2 weeks)

## 목표

ChatGPT 의존 래퍼가 아니라, 독립 실행 가능한 문서 QA 백엔드 시스템으로 완성한다.

## Week 1

1. Core 안정화
- 인덱싱/검색/질문 로직을 서비스 레이어로 통합
- MCP + REST 동시 제공
- 에러 응답 일관화

2. 품질 개선
- chunking 파라미터 튜닝
- 제목-only chunk 제외 규칙
- top-k 및 score threshold 적용

3. 운영성
- structured logging
- 요청 ID 추적
- timeout/retry 정책

## Week 2

1. 평가 체계
- 질의셋 30개 작성
- 지표 수집:
- citation hit rate
- top-k recall
- p95 latency

2. 테스트/CI
- 도구/서비스 단위 테스트
- REST 통합 테스트
- GitHub Actions: build + test

3. 문서화
- 아키텍처 다이어그램
- 의사결정 기록(왜 MCP+REST, 왜 저장소 분리)
- 트레이드오프 정리

## 면접 어필 포인트

1. 프로토콜 설계
- MCP와 REST를 함께 지원해 소비자(에이전트/앱)를 분리함

2. 검색 신뢰성
- 답변과 근거를 강제 결합해 hallucination 위험을 낮춤

3. 확장성
- 저장소 인터페이스 추상화로 in-memory/pgvector를 교체 가능

4. 운영감각
- health endpoint, 오류 표준화, 로그 추적으로 실서비스 전환 가능
