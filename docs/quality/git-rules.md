# Git 커밋과 병합 규칙

## 설치와 작업 위치

`npm ci` 또는 `npm install`의 prepare 단계가 `node harness/scripts/install-hooks.mjs`를 실행한다. 기존 checkout에서는 `npm run hooks:install`로 설치할 수 있다. 설치 결과는 `git config --get core.hooksPath`가 `.githooks`인지 확인한다. 상대 경로 설정은 linked worktree에도 적용되며 각 checkout의 hook을 사용한다.

다른 `core.hooksPath`가 있으면 덮어쓰지 않고 실패한다. 기존 hook의 역할을 검토한 뒤 명시적으로 통합해야 한다. CI, Git 없는 Docker 이미지, `.git` 없는 소스 배포에서는 설치를 건너뛰며 CI는 검사 스크립트를 직접 실행한다. 이미 생성된 과거 checkout에 `.githooks` 파일이 없으면 해당 checkout에는 검사 코드가 없으므로 최신 커밋을 동기화해야 한다.

구현과 커밋은 `codex/plan-NNN-task-name` 브랜치의 linked worktree에서 한다. `main`, detached HEAD, 일반 primary checkout의 커밋은 차단한다. 계획 번호는 001부터 시작하며 소문자·숫자·하이픈으로 작업 이름을 작성한다.

## 커밋 메시지

```text
fix(harness): enforce staged execution plans

Plan: plan-002-harness-git-rules
```

제목은 최대 100자이며 `type(scope): description` 형식이다. scope는 선택 사항이고 호환성 변경 표시는 `!`를 사용할 수 있다. 허용 type은 `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`다. scope는 소문자·숫자로 시작하고 소문자·숫자·점·밑줄·슬래시·하이픈을 사용할 수 있다. 설명은 비어 있으면 안 된다.

제목 뒤에 빈 줄을 두고 본문에 정확히 하나의 `Plan: plan-NNN-task-name` 줄을 넣는다. 로컬 커밋에서는 현재 브랜치의 계획과 일치해야 한다. 커밋할 tree에 해당 active 계획 또는 completed 계획과 같은 이름의 리뷰가 있어야 한다. `Merge ...` 제목만으로 검사를 우회할 수 없으므로 PR 병합 커밋에도 위 형식과 Plan 본문을 사용한다.

## 로컬 검사와 원격 검사

- `pre-commit`: 브랜치·linked worktree 확인, staged 계획/리뷰 확인, `git diff --cached --check`, Git index를 임시 디렉터리에 추출한 뒤 staged `verify_base.py`로 구조·계획 필수 섹션·문서 링크를 검사한다. 작업 트리에만 있는 계획이나 수정 내용은 통과 근거가 되지 않는다.
- `commit-msg`: 메시지 형식과 브랜치의 Plan 일치, staged 계획/완료 리뷰를 확인한다.
- `pre-push`: `refs/heads/main` 업데이트와 삭제를 차단한다. 작업 브랜치를 push한 뒤 검증된 PR로 병합한다. 작업 브랜치 삭제는 허용한다. 새 원격 ref는 전체 조상을, 기존 ref는 원격 SHA 이후 커밋을 검사한다. 원격 SHA가 로컬에 없으면 fetch 후 재시도해야 한다.
- CI: 로컬 hook 우회에 대비해 커밋 범위를 다시 검사한다. 각 커밋 메시지와 그 커밋의 tree에 있는 계획을 확인한다. PR의 완료 계획·리뷰 검사와 필수 품질 검사를 통과한 뒤 병합한다.

규칙 도입 이전의 정확히 두 커밋만 역사적 예외다. 메시지 문구나 날짜로 예외를 판단하지 않는다.

- `7e239884838fe842151c10f897a367d9905387ea`: 초기 커밋.
- `4529e24360616549ddb1e1d7757cf19462caf72e`: 기존 하네스 기반 커밋.

로컬 hook은 `--no-verify` 등으로 우회할 수 있으므로 원격 브랜치 보호의 필수 CI와 함께 사용한다. 설치 스크립트 자체가 원격 보호 규칙을 설정하지 않는다. 실제 원격 설정과 검증 결과는 실행 계획과 완료 리뷰에 기록한다.

## 수동 실행과 회귀 검사

```sh
npm run hooks:install
node harness/scripts/git-policy.mjs pre-commit
node harness/scripts/git-policy.mjs commit-msg /path/to/COMMIT_EDITMSG
node harness/scripts/git-policy.mjs range origin/main HEAD
node --test harness/tests/git-policy.test.mjs
```

`pre-push`는 Git이 전달하는 표준 입력(`<local-ref> <local-sha> <remote-ref> <remote-sha>`)을 읽는다. 검사 명령은 성공 시 0, 규칙 위반 시 1을 반환한다. Node.js·Python·Git 외 추가 패키지가 필요 없다. 회귀 검사는 임시 실제 Git 저장소와 linked worktree, bare remote에서 설치·잘못된 커밋·staged 계획·완료 전환·커밋 범위·push/삭제 동작을 검증한다.

## GitHub 병합 메시지

PR 제목과 본문도 같은 제목·Plan 규칙을 따른다. CI의 `check-pr.mjs`가 GitHub event JSON을 데이터로 읽어 검사하며 PR 본문을 셸 코드로 실행하지 않는다. PR은 head 브랜치에 대응하는 completed 계획과 리뷰가 있어야 병합 검사를 통과한다.

저장소의 merge/squash 기본 메시지는 PR 제목·본문을 사용하도록 설정한다. 병합할 때도 `Plan:` 줄을 보존한다. 직접 수정한 병합 메시지는 검증된 PR 메시지와 동일한 규칙을 따라야 한다.
