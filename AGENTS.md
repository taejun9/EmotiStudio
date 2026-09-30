# Team Emoti — Agent Map

Emoti Studio는 캐릭터 바이블을 기준으로 이모티콘 기획·생성·수정·규격 검사·내보내기를 연결한다. 현재는 개발 기반만 있으며 앱은 미구현이다.

## 역할

| id | nickname | 책임 |
|---|---|---|
| project_lead | 총괄 | 범위 결정, 작업 조율, 사용자 보고 |
| plan_keeper | 설계 | 실행 계획, 결정 기록, 완료 이동 |
| repo_cartographer | 지도 | 저장소 지도, 도메인 경계 |
| harness_builder | 제작 | 반복 가능한 검사와 도구 |
| quality_runner | 검증 | QA 실행, 실패 증거, 재검증 |
| review_judge | 심사 | QA 이후 리뷰, 잔여 위험 |
| privacy_guard | 수호 | 참조 이미지 권리, 비밀키, AI 데이터 전송 |
| doc_gardener | 정리 | 문서 최신화, 완료 리뷰, 링크 |

보고는 한국어로 `<nickname>: <content>` 형식을 사용한다. 역할은 책임 구분이며 상시 실행 에이전트가 아니다. 명시적으로 위임받은 경우에만 서브에이전트를 실행하고, 파일 소유 범위를 나누며 다른 작업을 되돌리지 않는다.

## 먼저 읽기

- [제품과 MVP](docs/product/product.md), [후속 작업](docs/product/roadmap.md)
- [시스템 설계](docs/architecture/system.md), [도메인 모델](docs/architecture/domain-model.md)
- [규격 프리셋](docs/architecture/platform-presets.md), [공식 출처](docs/references/official-sources.md)
- [작업 생명주기](docs/architecture/harness.md), [QA 규칙](docs/quality/rules.md)
- [데이터·권리 원칙](docs/privacy/principles.md), [회의 기록](docs/meetings/index.md)

## No Exec Plan, No Work

구현 전 `docs/exec_plans/active/plan-NNN-<task>.md`를 만든다. 범위·접근법 변경은 Decision Log에 먼저 또는 동시에 남긴다. `docs/plan`은 금지한다.

`main`에서 기능 구현·커밋을 하지 않는다. `codex/plan-NNN-<task>`와 격리 worktree를 사용한다. CLI 기본 경로는 `.worktree/plan-NNN-<task>`이며 앱 관리 worktree는 도구가 반환한 경로를 사용한다.

QA → 별도 리뷰 → 계획을 [completed](docs/exec_plans/completed/)로 이동 → [리뷰](docs/reviews/) 작성 → main 병합·push → `git branch -d` → worktree 정리 순서를 지킨다. 구체적인 안전 절차와 차단 시 처리는 작업 생명주기를 따른다.

## 검증

```sh
python3 harness/scripts/verify_base.py --implementation
python3 harness/scripts/verify_base.py
python3 -B -m unittest discover -s harness/tests -p 'test_*.py'
git diff --check
```

첫 명령은 작업 브랜치·활성 계획·linked worktree를 추가 검사한다. 병합 후 main에서는 기본 명령을 사용한다. 앱의 test/lint/typecheck/build 명령은 스택 선정 후 추가한다.

루트 Markdown은 README.md와 AGENTS.md만 유지한다. 기존 README.md는 이번 기반 작업에서 보존했다. 카카오 규격·AI 허용 정책·일관성 수치는 근거 없이 확정하지 않는다.
