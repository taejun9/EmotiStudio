# plan-002-harness-git-rules Review

## Summary

2026-09-30. QA 완료 후 별도 review 에이전트가 독립 코드 리뷰를 수행했다. 하네스 누락 원인은 plan-001 커밋 미병합과 이후 앱 미추적 상태였고, 기존 기반 커밋의 이력을 보존해 통합했다. 수정된 P2 1건, 남은 차단 사항 없음.

## QA

- `npm run harness:implementation`: 작업 브랜치·활성 계획·linked worktree 포함 통과(완료 이동 전).
- `npm run verify`: Python 10개, Git 정책 13개, 앱 48개, Playwright 10개 — 총 81개 통과. 형식·타입·빌드 포함.
- 실제 임시 Git 저장소에서 설치·정상 커밋·잘못된 제목/계획·main/detached/primary checkout 차단·staged 누락·완료 리뷰·커밋 범위·push/삭제를 검증했다.
- PR 메타데이터 정상/잘못된 제목/잘못된 Plan fixture 확인.
- hook 실행 비트 100755, core.hooksPath=.githooks, staged diff 및 pre-commit 구조 검사 통과.
- 리뷰는 전체 QA를 중복 실행하지 않고 총괄의 통과 결과를 근거로 코드·설정·diff를 검토했다.

## Findings

- P2 수정: pull_request 기본 이벤트에는 edited가 없어 제목·본문 검사 통과 후 메시지가 변경될 수 있었다. 명시적으로 edited 이벤트를 추가하고 리뷰어가 재확인했다.
- E2E는 production 빌드·실행별 임시 DB·빈 AI 키를 사용하며 기존 서버 재사용을 거부한다. 종료 및 시작 실패 시 자기 데이터만 제거한다.
- 배포용 HTML이 숨김 worktree 상위 경로에서 404가 되는 기존 문제를 trusted dist root 기준 sendFile로 수정했다. 숨김 경로에서 root·하위 경로 200 응답 회귀 검사가 있다.
- Git hooks 및 CI 검사 범위, 두 역사적 커밋만 예외인 정책, Docker prepare 경로의 정합성을 확인했다.
- 원본 앱 대비 src/shared 변경 없음. 서버 변경은 HTML 제공 경로 한 줄이다.

## Residual Risk

로컬 hooks는 사용자가 비활성화할 수 있다. GitHub 보호 규칙/필수 CI와 병합 메시지 설정은 원격 API로 적용 및 확인한다. 관리자가 웹 병합 메시지를 수동 변경할 경우에도 규칙을 유지해야 한다. 실제 AI 호출과 Docker 이미지 빌드는 이번 범위에 포함하지 않았다.

## Follow-Ups

이 기록은 커밋·원격 반영 전 리뷰다. 브랜치 push → PR CI 통과 → main 병합 → 로컬 동기화 순서로 완료하고 PR과 최종 보고에 실제 결과를 기록한다. 사용자 작업과 다른 채팅이 보유한 worktree는 보존한다.
