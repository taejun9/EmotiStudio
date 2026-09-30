# 공식 출처 등록부

확인 기준일: 2026-09-30 (Asia/Seoul). 외부 규격과 저장소 설계 결정을 구분한다. 확인되지 않은 값은 구현 전 공백으로 남긴다.

| ID / 출처                                        | URL                                              | 범위                                     | checked_at | 확인 결과와 사용                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------ | ---------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| KAKAO-STUDIO / 카카오 이모티콘 스튜디오          | https://emoticonstudio.kakao.com/                | 공식 창작 플랫폼 진입점                  | 2026-09-30 | 브라우저 본문에서 제안·심사·보완·출시 흐름과 공식 작가 안내서 연결 확인. 숫자 규격 근거로 사용하지 않음                    |
| KAKAO-GUIDE / 이모티콘 작가 안내서               | https://kakaoemoticonstudio.notion.site/         | 제안/상품화 규격 확인 대상               | 2026-09-30 | 텍스트 조회는 404였지만 브라우저에서 작가 안내서·제안 과정·유형별 이미지 가이드 연결을 확인                                |
| KAKAO-STATIC / 멈춰있는 이모티콘                 | https://kakaoemoticonstudio.notion.site/emoticon | 정지 이미지의 구성·제작 안내             | 2026-09-30 | 브라우저 본문에서 수량·크기·형식·용량·투명 배경·아이콘·대표 이미지 확인. [근거와 남은 공백](kakao-static-evidence.md) 참고 |
| KAKAO-PROPOSAL / 제안                            | https://kakaoemoticonstudio.notion.site/proposal | 제안 과정과 콘텐츠 안내                  | 2026-09-30 | 유형별 가이드 확인 후 이미지·정보 등록, 권리 관련 주의 안내 확인. AI 제작물 허용 판단에는 사용하지 않음                    |
| PNG-SPEC / W3C PNG Specification (Third Edition) | https://www.w3.org/TR/png-3/                     | PNG 파일 구조와 투명도 표현              | 2026-09-30 | 형식 검증 설계 참고. PNG의 투명도 표현과 카카오의 배경 요구 충족을 구분                                                    |
| GIT-WORKTREE / Git worktree manual               | https://git-scm.com/docs/git-worktree            | linked worktree, detached checkout, 정리 | 2026-09-30 | 격리 체크아웃과 브랜치 분리 절차 참고. 앱 관리 경로와 archive 절차는 실행 환경 지침에 따름                                 |

## 확인된 짧은 근거

공식 스튜디오 홈페이지는 “이모티콘 작가 안내서 이동” 링크를 제공하며 제안 뒤 심사·보완·출시가 이어지는 흐름을 표시한다. 이는 파일 생성이 심사 승인을 뜻하지 않는 제품 경계의 근거다. 수량·용량 등은 홈페이지가 연결한 정지 이미지 상세 안내서에서 별도로 확인했다. AI 허용 정책은 확인하지 못했다.

## 아직 필요한 출처

- 확인한 정지 이미지 구성 규칙의 제안/상품화 단계별 적용, KB 바이트 환산, 메타데이터 강제 여부, 파일명·패키징 요구.
- 카카오 상품화 단계와 움직임·큰 이모티콘 규격은 별도로 확인.
- 생성형 AI 제작물의 제출/권리 관련 공식 정책. 허용이나 금지 어느 쪽도 추정하지 않는다.
- 채택할 프레임워크·저장소·배포·AI 공급자의 공식 API/편집 capability/보관·학습·요금 문서.

제공된 기획에는 카카오 Notion 개별 페이지 URL과 실제 참조 이미지가 없다. 공식 홈페이지에서 연결된 작가 안내서와 상세 페이지를 직접 찾아 등록했다. 비공식 블로그의 숫자를 검증된 프리셋에 복사하지 않는다.

## 업데이트 규칙

출처 이름·URL·적용 플랫폼/단계·확인 날짜·사용 목적을 함께 기록한다. 각 규칙은 원문 위치와 짧은 근거 또는 의역에 연결한다. 원문 미확보와 확인했으나 해당 조건 없음은 구분한다. 규격·정책·가격이 바뀔 수 있는 구현을 시작할 때 다시 확인한다.

## 내부 입력

사용자 제공 Emoti Studio 기획과 호출된 base 스킬의 terms-signal/codex-surfaces 참조를 기반으로 구조를 만들었다. 이 입력들은 플랫폼 공식 규격이나 법률 판단의 근거가 아니다. 사용자 첨부의 로컬 절대 경로나 원문 전체는 공개 저장소에 복제하지 않는다.

## Git 및 QA 하네스 근거

2026-09-30 확인. 제품 플랫폼 규격과 별개로 저장소 검증에 사용한다.

- [Git hooks](https://git-scm.com/docs/githooks): 실행 비트, core.hooksPath, commit-msg/pre-commit/pre-push 호출 계약. 로컬 hook은 우회 가능하므로 원격 검사와 함께 사용한다.
- [npm lifecycle scripts](https://docs.npmjs.com/cli/v11/using-npm/scripts/): prepare를 설치 단계에 연결한다. Git 없는 배포 디렉터리와 CI에서는 hook 설치를 건너뛴다.
- [GitHub 보호 브랜치](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches): PR 및 필수 상태 검사로 main 병합을 제한한다. 실제 적용 여부는 GitHub API로 별도 확인한다.

현재 앱의 구현 계약은 [API 계약](../API-CONTRACT.md), 실제/모의 검증 범위는 [QA 기록](../QA.md)을 따른다. 위 초기 설계의 공급자 미선정 기록은 plan-001 시점의 근거 공백이며 현재 스택 상태는 [시스템 설계](../architecture/system.md)에서 확인한다.
