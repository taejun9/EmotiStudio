# Team Emoti — Agent Map

EmotiStudio는 React/Vite 클라이언트와 Express/SQLite 서버로 동작하는 이모티콘 제작 앱이다. 캐릭터 컨셉 → 정지·움직이는 세트 → 생성·검수·수정 → ZIP 내보내기를 제공한다. 원래 기획의 버전별 Character Bible과 전체 플랫폼 규격 검사기는 후속 설계다.

## 역할

| id                | nickname | 책임                                     |
| ----------------- | -------- | ---------------------------------------- |
| project_lead      | 총괄     | 범위 결정, 작업 조율, 사용자 보고        |
| plan_keeper       | 설계     | 실행 계획, 결정 기록, 완료 이동          |
| repo_cartographer | 지도     | 저장소 지도, 도메인 경계                 |
| harness_builder   | 제작     | 반복 가능한 검사와 도구                  |
| quality_runner    | 검증     | QA 실행, 실패 증거, 재검증               |
| review_judge      | 심사     | QA 이후 리뷰, 잔여 위험                  |
| privacy_guard     | 수호     | 참조 이미지 권리, 비밀키, AI 데이터 전송 |
| doc_gardener      | 정리     | 문서 최신화, 완료 리뷰, 링크             |

보고는 한국어로 `<nickname>: <content>` 형식을 사용한다. 역할은 책임 구분이며 상시 실행 에이전트가 아니다. 위임 시 파일 소유 범위를 나누고 다른 작업을 되돌리지 않는다.

## 먼저 읽기

- [실행·운영](README.md), [API 계약](docs/API-CONTRACT.md)
- [제품과 후속 범위](docs/product/product.md), [백로그](docs/product/roadmap.md)
- [시스템](docs/architecture/system.md), [도메인](docs/architecture/domain-model.md)
- [작업 생명주기](docs/architecture/harness.md), [QA 규칙](docs/quality/rules.md)
- [규격 프리셋 설계](docs/architecture/platform-presets.md), [공식 출처](docs/references/official-sources.md)
- [데이터·권리 원칙](docs/privacy/principles.md), [회의 기록](docs/meetings/index.md)

## No Exec Plan, No Work

구현 전 `docs/exec_plans/active/plan-NNN-<task>.md`를 만든다. 범위·접근법 변경은 Decision Log에 먼저 또는 동시에 남긴다. `docs/plan`은 금지한다.

`main`에서 기능 구현·커밋·직접 push를 하지 않는다. `codex/plan-NNN-<task>`와 격리 linked worktree를 사용한다. 앱 관리 worktree는 도구가 반환한 경로를 사용한다. 일반 CLI 기본 경로는 `.worktree/plan-NNN-<task>`다.

QA → 별도 리뷰 → 계획 completed 이동·리뷰 작성 → 작업 브랜치 커밋·push → PR 검사 통과·main 병합 → 로컬 main 동기화 → 병합 브랜치 삭제·사용이 끝난 worktree 정리 순서를 지킨다. 커밋은 Conventional Commit 제목과 `Plan:` footer를 사용한다. 상세 형식과 차단 시 처리는 작업 생명주기를 따른다.

## 검증

```sh
npm ci
python3 harness/scripts/verify_base.py --implementation
npm run verify
git diff --check
```

Node.js 24.15 이상과 Python 3.9 이상이 필요하다. `npm ci`의 prepare 단계에서 Git hook을 설치한다. `--implementation`은 작업 브랜치·활성 계획·linked worktree를 추가 검사한다. 계획 완료 후에는 `npm run harness:check`로 구조를 검사한다. `verify`는 형식·하네스·타입·앱 테스트·빌드·격리 E2E를 실행한다.

루트 Markdown은 README.md와 AGENTS.md만 유지한다. API 키와 실제 사용자 데이터를 커밋하지 않는다. 카카오 규격·AI 허용 정책·일관성 수치를 근거 없이 확정하지 않는다.
