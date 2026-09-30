# 저장소 작업 생명주기

## 시작

기존 변경과 연결된 worktree를 확인하고 사용자 작업을 보존한다. `git fetch origin`으로 원격을 확인한다. `main`은 PR을 통합하는 브랜치다. 구현은 `codex/plan-NNN-<task>`와 격리 linked worktree에서 진행한다.

Codex 앱에서는 기존 attachment를 먼저 확인하고 적합한 worktree를 재사용한다. 새 worktree가 필요하면 관리 도구로 생성한 경로를 사용한다. 일반 CLI 기본 체크아웃은 `.worktree/plan-NNN-<task>`이며 도구가 없거나 수동 생성이 명시된 경우에만 Git CLI로 만든다. 경로 선택은 계획에 기록한다.

구현 전에 [계획 템플릿](../../harness/templates/exec-plan.md)으로 `docs/exec_plans/active/plan-NNN-<task>.md`를 만든다. 번호는 active와 completed 전체에서 고유해야 한다. 경로·범위·결정·실패·검증 결과를 계획에 기록한다.

## Git 규칙

`npm ci`의 `prepare` 단계에서 저장소 Git hook을 설치한다. 의존성을 이미 설치했다면 `npm run prepare`로 다시 설치할 수 있다. 새 clone/worktree에서도 설치 상태를 확인한다.

- 커밋 제목은 `fix(harness): enforce repository workflow`와 같은 Conventional Commit 형식을 사용하며 최대 100자다.
- 제목 뒤 빈 줄을 두고 본문 footer에 `Plan: plan-NNN-<task>`를 정확히 하나 넣는다. 현재 작업 브랜치와 같은 계획을 가리켜야 한다.
- pre-commit은 staged 변경을 기준으로 작업 브랜치·linked worktree·계획을 검사한다. 완료 문서를 커밋할 때는 같은 계획의 completed 기록과 리뷰가 필요하다.
- commit-msg는 제목과 계획 footer를 검사한다.
- pre-push는 `main` 직접 push를 막는다. 작업 브랜치를 push하고 PR로 통합한다.
- CI는 새 커밋 범위에 커밋 정책을 적용한다. 도입 전 기존 커밋은 역사를 재작성하지 않고 보존한다.

```text
fix(harness): enforce repository workflow

Plan: plan-002-harness-git-rules
```

정확한 허용 형식·검사 명령·도입 전 예외는 [Git 규칙](../quality/git-rules.md)을 따른다. 로컬 hook은 실수를 조기에 잡는 장치다. 사용자가 생략하거나 설치하지 않을 수 있으므로 CI 검사와 원격 보호 규칙의 역할을 대체하지 않는다. 필요한 PR 검사와 병합 정책은 원격 저장소에도 설정한다.

## 작업과 완료 순서

1. 범위나 접근법을 바꿀 때 Decision Log를 먼저 또는 동시에 수정한다.
2. [QA 규칙](../quality/rules.md)에 따라 `npm run verify`와 diff 검사를 실행하고 증거를 남긴다.
3. QA 통과 후 리뷰한다. 같은 에이전트가 역할을 바꿨다면 독립 리뷰라고 부르지 않는다.
4. 리뷰 지적을 수정하면 관련 QA를 다시 실행하고 검토한다.
5. 계획 Status를 completed로 바꾸고 completed 폴더로 이동한다. 같은 파일명의 리뷰를 `docs/reviews/`에 쓴다.
6. 구조·형식·staged diff를 검사하고 규칙에 맞는 커밋을 만든다.
7. 작업 브랜치를 push하고 PR을 만든다. 최신 원격 main을 기준으로 충돌과 필수 검사를 해결한다.
8. PR 검사가 통과하면 허용된 병합 방식으로 main에 통합한다. squash를 사용하면 최종 커밋에도 제목과 `Plan:` footer를 보존한다.
9. 원격 main에 반영된 것을 확인하고 로컬 main을 fast-forward로 동기화한다. 사용자 변경이 있으면 보존하고 별도로 보고한다.
10. 사용이 끝난 작업 브랜치와 worktree를 정리한다. 병합이 확인된 브랜치는 `git branch -d`를 사용한다. 관리 worktree는 실행 중인 작업/프로세스가 없는지 확인한 뒤 `archive_worktree`로 보관 정리한다.

보호 브랜치·권한·충돌·검사·push 실패는 정확한 차단 사유와 현재 상태를 보고하고 해결한다. force push, 보호 규칙 우회, 다른 작업 덮어쓰기, 강제 브랜치 삭제로 진행하지 않는다. 원격 변경 권한은 사용자 요청과 환경 정책을 따른다.

완료 계획은 구현·QA·리뷰 완료 기록이다. PR URL, main 반영·로컬 동기화·정리 상태는 Completion Notes와 최종 보고로 추적한다. 실행하지 않은 단계를 완료라고 기록하지 않는다. 다른 작업이 사용하는 worktree는 유지한다.

## 문서와 검증 경계

[README](../../README.md)는 실행·운영의 시작점이며 [AGENTS](../../AGENTS.md)는 저장소 작업 지도를 제공한다. 제품·구조·품질·개인정보·출처는 `docs/` 하위에, 실행 계획·회의·리뷰는 각각의 기록 폴더에 둔다. 루트에 별도 보고서를 쌓지 않는다.

기본 구조 검사기는 파일·계획·리뷰 대응·문서 링크를 검사한다. `--implementation`은 현재 작업 브랜치·활성 계획·linked worktree를 추가 검사한다. 완료 계획 이동 후와 main에서는 기본 검사인 `npm run harness:check`를 사용한다. 이 검사는 과거 QA 수행이나 원격 보호 설정을 증명하지 않으므로 실행 증거와 실제 설정을 별도로 확인한다.
