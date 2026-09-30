# plan-002-harness-git-rules

## Status

completed

## Owner

project_lead / 총괄

## User Request

프로젝트 하네스와 Git 커밋 규칙을 점검하고 문제를 수정한 뒤 push 및 merge한다. 디스크 확보 후 재개 요청도 확인했다.

## Goal

기존 하네스와 미커밋 앱을 통합하고, 실행 가능한 로컬/CI Git 규칙 및 격리된 QA를 통해 main까지 반영한다.

## Non-Goals

제품 기능 추가, 유료 AI 호출, 실제 사용자 데이터 변경, 배포.

## Context Map

main에는 초기 README만 있다. 기존 하네스 커밋 4529e24는 plan-001-project-base worktree에 미병합 상태로 남았고 앱 파일은 원래 checkout에서 미추적 상태다. 원격 main 보호와 Git hooks가 없다.

## Constraints

- codex/plan-002-harness-git-rules 및 앱 관리 worktree 사용.
- 원래 checkout, data/.env, 다른 worktree의 작업을 보존한다.
- QA 후 독립 리뷰. force push 없이 PR로 병합한다.

## Implementation Plan

- [x] 기존 기반 커밋에서 작업 브랜치 생성 및 앱 파일 복사
- [x] Git hooks, 메시지/계획 검사 및 실패 회귀 테스트
- [x] 문서 최신화 및 QA/CI 연결
- [x] E2E DB 격리와 테스트 안정성 수정
- [x] QA, 독립 리뷰, 완료 계획/리뷰 기록
- [ ] push, PR 병합, main 동기화 및 작업 브랜치 정리

## QA Plan

- 구조 검사 기본/implementation 모드와 기존 Python 회귀 검사
- 실제 임시 Git 저장소에서 올바른/잘못된 커밋, main 차단, staged 계획 확인
- 형식, 타입, 서버 테스트, 빌드 및 격리된 Playwright 검사
- 원격 CI 통과 후 병합, 원격 main과 로컬 커밋 비교

## Review Plan

QA 완료 후 별도 에이전트가 Git 규칙/CI/데이터 격리/기존 작업 보존을 리뷰한다. 수정하면 관련 검증을 재실행한다.

## Decision Log

- 새 기반을 중복 생성하지 않고 4529e24를 조상으로 보존한다. 기존 앱 전체를 최초 버전 관리 기준선으로 포함한다.
- Conventional Commits 제목과 Plan 본문 참조를 새 커밋에 적용한다. 기존 두 커밋은 명시적 역사적 예외다.
- 관리형 worktree 경로는 .codex/worktrees/harness-git-rules/EmotiStudio이다.
- QA는 기존 node_modules 연결을 사용하고 원격 CI에서 npm ci로 신규 설치를 검증한다.
- 이전 시도는 ENOSPC로 중단됐다. 사용자 재개 후 여유 공간 7.9GiB를 확인했다.
- PR/필수 CI로 main을 보호하고 로컬 main에 기능 커밋을 만들지 않는다.

- 배포 빌드 E2E에서 숨김 상위 디렉터리(.codex) 아래의 절대 sendFile 경로가 404가 되는 기존 문제를 발견했다. distDir을 명시적 root로 제한해 index.html을 제공하고 숨김 경로 회귀 검사를 추가한다.

- GitHub merge/squash 기본 메시지를 PR 제목·본문으로 설정하고 CI에서 PR 제목과 Plan 참조도 검사한다. 웹 병합이 다음 커밋 검사에서 실패하는 경로를 막는다.

## Progress Log

- 2026-09-30 총괄: 점검 및 보존 복사 완료, 구현 시작.

- 2026-09-30 검증: 전체 QA 통과.
- 2026-09-30 심사: 독립 에이전트 리뷰의 P2 1건 수정 확인 및 차단 사항 없음.

## Completion Notes

- 로컬 구현·QA·독립 리뷰 완료. `npm run verify`: 하네스 23개 + 앱 48개 + 브라우저 10개, 총 81개 통과. implementation/형식/타입/빌드/staged 검증도 통과.
- 검수 모달 접근성 및 임시 DB·시작 실패·숨김 경로 회귀 검사를 포함했다. PR 메시지 정상/실패 fixture도 검증했다.
- 독립 리뷰에서 PR edited 이벤트 누락 1건을 발견해 수정 후 재검토했다. 남은 차단 지적 없음.
- 원본 checkout의 76개 파일 해시가 보존 복사 시점과 동일함을 확인했다. data/.env는 다루지 않았으며 stage에도 없다.
- 이번 커밋 시점은 원격 반영 전이다. 다음 순서는 브랜치 push, PR 생성, 필수 CI와 main 보호 적용 확인, merge, 로컬 fast-forward 및 사용이 끝난 worktree 정리다. 실제 결과는 연결된 PR과 최종 보고에서 확인한다.
- 유료 AI 호출 및 Docker 이미지 빌드는 실행하지 않았다. 로컬 hook은 사용자가 우회할 수 있으므로 PR 검사와 원격 보호를 함께 사용한다.
