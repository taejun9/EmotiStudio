# QA와 리뷰 규칙

## 실행 환경과 명령

Node.js 24.15 이상, Python 3.9 이상, Git을 사용한다. 작업 worktree에서 `npm ci`로 의존성과 Git hook을 설치한다. 현재 앱에는 별도 ESLint 명령이 없으며 형식 검사는 Prettier, 타입 검사는 TypeScript로 실행한다.

```sh
python3 harness/scripts/verify_base.py --implementation
npm run verify
git diff --check
git diff --cached --check
```

구현 중에는 `--implementation`으로 작업 브랜치·활성 계획·linked worktree를 검사한다. 계획을 completed로 이동한 후와 main에서는 기본 구조 검사인 `npm run harness:check`를 사용한다.

| 명령                    | 검사 범위                                             |
| ----------------------- | ----------------------------------------------------- |
| `npm run format:check`  | Prettier 형식                                         |
| `npm run harness:check` | 문서·계획·리뷰·링크 구조                              |
| `npm run test:harness`  | Python 구조 검사 회귀 테스트와 Node Git 정책 테스트   |
| `npm run typecheck`     | TypeScript 타입                                       |
| `npm test`              | Node 테스트 러너 기반 앱 단위·API 통합·미디어 회귀    |
| `npm run build`         | 타입 검사와 Vite production 빌드                      |
| `npm run test:e2e`      | Playwright 브라우저 흐름·접근성 검사; 먼저 build 필요 |
| `npm run qa`            | 형식·하네스 구조/회귀·타입·앱 테스트·빌드             |
| `npm run verify`        | qa와 E2E                                              |

CI에서도 같은 품질 검사를 실행하고 새 커밋 범위의 Git 메시지 정책을 검사한다. 로컬 성공만으로 원격 필수 검사가 통과했다고 기록하지 않는다.

## 데이터 격리와 증거

API 테스트는 임시 디렉터리의 DB를 사용한다. E2E는 `127.0.0.1:4173`의 빌드된 production 앱을 전용 서버로 실행하고 임시 데이터 디렉터리를 종료 시 정리한다. 개발 서버나 기본 `./data`를 재사용하지 않으며 실제 이미지 API 키는 비운다. 로컬 브라우저는 설치된 Google Chrome, CI는 Playwright Chromium을 사용한다. CI 브라우저 설치 명령은 `npx playwright install --with-deps chromium`이다.

실제 AI 호출은 기본 QA에 넣지 않는다. 필요한 경우 비용과 전송할 이미지 범위를 명시하고 모의 응답·sample 테스트와 구분해 기록한다. 검증 기록은 [docs/QA.md](../QA.md)와 해당 실행 계획에 둔다. 어떤 테스트가 통과했는지와 미검증 영역을 구분한다.

## 하네스와 Git 정책 QA

구조 검사기는 필수 파일·디렉터리, 루트 Markdown, `docs/plan` 금지, 계획 이름·번호·상태·섹션, 완료 계획/리뷰 대응, Markdown 상대 파일 링크를 검사한다. inline 파일 링크의 존재만 검사하며 anchor·외부 URL·문서 내용의 진위는 검사하지 않는다.

정책 변경에는 실제 실패를 검출하는 fixture를 사용한다. 잘못된 브랜치·worktree·staged 계획·커밋 메시지·main push와 정상 흐름을 검사하며 사용자의 실제 저장소나 원격을 테스트 fixture로 쓰지 않는다. hook 설치와 실행은 [작업 생명주기](../architecture/harness.md)와 [Git 규칙](git-rules.md)을 따른다. 과거 커밋에 새 규칙을 소급 적용해 역사를 다시 쓰지 않는다.

## 제품 회귀와 후속 검사

현재 구현의 소유권·게스트 이관·생성 한도, 부분 실패·중복 실행, 버전·대사 원본 보존, 프레임 출력, 승인·완료·ZIP 조건을 해당 앱 테스트로 확인한다. 다음 설계를 구현할 때는 추가 인수 검사를 계획한다.

- 바이블 갱신 시 이전 후보의 원래 버전과 입력 스냅샷 보존.
- 후보 계보·취소·늦은 결과에서 사용자 선택 유실 방지.
- 규격 개수·크기·용량 경계, 실제 포맷·투명도·누락/중복 파일명.
- 근거 unknown을 통과로 처리하지 않기, 규격·선택 변경 시 stale 처리.
- 검사한 파일과 ZIP의 일치, 경로 안전성, 비밀과 원본 업로드 배제.

## 리뷰

QA 완료 후 [리뷰 템플릿](../../harness/templates/review.md)을 사용한다. 요구사항 누락, 데이터 경계, 출처 없는 규격·정책 주장, 작동하지 않는 명령을 살핀다. 수정이 생기면 관련 QA부터 다시 실행한다. 실패·미검증·리뷰 독립성의 한계를 숨기지 않는다.

완료 계획은 completed로 이동하고 같은 basename의 리뷰를 `docs/reviews/`에 둔다. 하네스 통과는 앱 기능 전체·카카오 적합성·법적 권리를 보증하지 않는다.
