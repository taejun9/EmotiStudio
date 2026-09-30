# 저장소 작업 생명주기

## 시작

기존 변경과 연결된 worktree를 확인하고 사용자 작업을 보존한다. `git fetch origin`으로 원격을 확인한다. main은 통합 브랜치다. 구현은 `codex/plan-NNN-<task>`와 격리 linked worktree에서만 한다.

일반 CLI 기본 체크아웃은 `.worktree/plan-NNN-<task>`다. Codex 앱에서는 기존 attachment를 먼저 확인하고 적합한 worktree를 재사용한다. 새 worktree가 필요하면 관리 도구로 생성한 경로를 사용한다. 경로 예외는 계획에 기록한다. 도구가 없거나 수동 생성이 명시된 경우에만 Git CLI로 생성한다.

구현보다 먼저 [계획 템플릿](../../harness/templates/exec-plan.md)으로 `docs/exec_plans/active/plan-NNN-<task>.md`를 만든다. 계획 번호는 active와 completed 전체에서 중복되지 않아야 한다. 경로·범위·결정·실패·검증 명령을 계획에 기록한다.

## 작업과 완료 순서

1. 범위나 접근법을 바꿀 때 Decision Log를 먼저 또는 동시에 수정한다.
2. [QA 규칙](../quality/rules.md)의 검사를 실행하고 결과를 기록한다.
3. QA 통과 후 리뷰한다. 같은 에이전트가 역할을 바꿨다면 독립 리뷰라고 부르지 않는다.
4. 리뷰 지적을 수정하면 영향을 받은 QA를 재실행하고 다시 검토한다.
5. 계획 Status를 completed로 바꾸고 completed 폴더로 이동한다. 같은 파일명의 리뷰를 docs/reviews에 쓴다.
6. 구조 검증과 diff 검사를 다시 실행하고 작업 브랜치에 커밋한다.
7. 원격 main과 로컬 상태를 다시 확인한 뒤 main에 통합하고 `git push origin main`을 실행한다. force push는 사용하지 않는다.
8. push 성공과 원격 커밋 일치를 확인한다. worktree를 해당 커밋의 detached HEAD로 전환한 뒤 main에서 `git branch -d codex/plan-NNN-<task>`로 병합 브랜치를 삭제한다.
9. 다른 작업/프로세스가 체크아웃을 쓰지 않는지 확인하고 관리 worktree는 archive_worktree로 보관 정리한다. 일반 CLI worktree는 Git의 제거 명령을 사용한다.

이 `$base` 실행은 위 생명주기까지 요청한 것으로 처리한다. 이후 작업의 원격 변경 권한은 해당 사용자 요청과 환경 정책을 따른다. 보호 브랜치·권한·충돌·push 실패가 있으면 다음 단계로 우회하지 말고 정확한 차단 사유와 현재 브랜치/계획 상태를 보고한다. 다른 사람의 변경을 덮어쓰거나 강제로 삭제하지 않는다.

완료 계획은 구현·QA·리뷰 완료 기록이다. main 통합/push/정리 상태는 Completion Notes와 최종 작업 보고로 별도 추적한다. 원격 반영 전에는 원격 반영 완료라고 기록하지 않는다.

## 문서와 검증 경계

README.md는 기존 두 줄을 보존했다. 이번 작업의 시작 안내는 [AGENTS.md](../../AGENTS.md)다. 루트에 별도 보고서를 쌓지 않는다. 제품·구조·품질·개인정보·출처는 docs 하위에, 회의·완료 리뷰는 각 기록 폴더에 둔다.

기본 구조 검사기는 파일·계획·문서 링크를 검사한다. `--implementation`은 현재 브랜치와 활성 계획, linked worktree를 추가 검사한다. 이 검사는 과거 QA/리뷰 수행이나 Git 권한을 증명하지 않으므로 계획과 리뷰에 실행 증거를 남긴다.
