# QA와 리뷰 규칙

## 현재 실행 명령

제품 스택은 미정이다. 외부 패키지 설치 없이 Python 3.9 이상 표준 라이브러리와 Git을 사용한다. 이번 환경에서 Python 3.14.5로 확인했다.

저장소 또는 작업 worktree 루트에서:

```sh
python3 harness/scripts/verify_base.py --implementation
python3 harness/scripts/verify_base.py
python3 -B -m unittest discover -s harness/tests -p 'test_*.py'
git diff --check
```

구현 중에는 첫 명령을 사용한다. 활성 계획을 completed로 옮긴 후와 main에서는 기본 명령을 사용한다. 스크립트는 성공 0, 규칙 위반 1을 반환한다. `--root /path/to/repo`로 별도 fixture의 구조만 검사할 수 있다. `git diff --cached --check`는 커밋 직전 staged 변경에도 실행한다.

| 검사 | 현재 상태 | 도입 시점 |
|---|---|---|
| 기반 구조·계획·문서 링크 | verify_base.py로 실행 가능 | 지금 |
| 앱 unit/integration | 미정 — 앱 코드 없음 | 스택 선택·첫 기능 |
| lint/typecheck/build | 미정 — 도구·패키지 없음 | 최소 앱 셸 |
| 파일 규격 검사 | 설계만 있음 | 프리셋 근거 확보·검사기 구현 |
| 실제 AI 품질·비용·E2E | 미구현 | 공급자 선택 및 호출 범위 확정 |

설정되지 않은 npm 명령이나 빈 성공 스크립트를 추가하지 않는다. 스택을 정하면 실제 통과하는 명령을 이 문서에 기록하고 README 변경은 별도 요청 범위에 맞춰 진행한다.

## 기반 QA

필수 디렉터리·파일, 최소 루트 Markdown, docs/plan 금지, 계획 파일명·번호·상태·필수 섹션, 완료 계획/리뷰 대응, Markdown 상대 파일 링크를 검사한다. 링크는 inline Markdown의 파일 존재만 검사하며 anchor·외부 URL·문서 내용의 진위는 검사하지 않는다. 외부 출처는 수동 확인한다.

스크립트를 변경할 때는 정상 fixture와 누락 파일·잘못된 계획 이름·리뷰 없는 완료 계획 등 실패 fixture를 임시 디렉터리에서 확인한다. 제품 기능 테스트를 모방하는 빈 테스트는 만들지 않는다.

## 향후 제품 QA

- 캐릭터/프로젝트 분리, 바이블 갱신 시 기존 후보의 원래 버전 유지.
- 선택 후보 기반 수정, 계보 보존, 실패·취소·중복 요청에서 선택 유실 방지.
- 검사 개수·크기·용량 경계, 실제 포맷 불일치·불투명 이미지·누락/중복 이름.
- 프리셋 근거 unknown이면 통과 금지, 버전 변경 시 stale 처리.
- ZIP 경로 안전성, 검사한 파일과 내보낸 파일 일치, 비밀·원본 경로 배제.
- 실제 AI 호출 테스트는 기본 QA에 넣지 않고 비용과 데이터 전송 범위를 명시한다.

## 리뷰

QA 완료 후 [리뷰 템플릿](../../harness/templates/review.md)을 사용한다. 요구사항 누락, 데이터 경계, 출처 없는 규격·정책 주장, 작동하지 않는 명령을 살핀다. 수정이 생기면 관련 QA부터 다시 한다. 실패/미검증/독립성 한계를 숨기지 않는다.

완료 계획은 completed로 이동하고 같은 basename의 리뷰를 docs/reviews에 둔다. 검증 성공은 앱 작동·카카오 적합성·법적 권리를 보증하지 않는다.
