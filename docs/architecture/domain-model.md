# 도메인 모델 초안

아래는 논리 모델이며 DB 마이그레이션이나 확정된 API 스키마가 아니다. `Emoji`는 기획의 이모티콘 한 칸을 뜻한다.

| 엔터티 | 주요 데이터 | 관계·조건 |
|---|---|---|
| Character | id, name, description, personality | 하나의 캐릭터가 여러 Project를 소유 |
| CharacterBibleVersion | id, character_id, version, visual_dna, style_prompt | 사용된 버전은 덮어쓰지 않는다. |
| CharacterReference | id, character_id, asset_id, view_type, priority, is_master | 파일 교체 시 새 자산/버전, 권리 확인 기록 연결 |
| Asset | id, content_hash, storage_key, media_type, byte_size, owner_id | URL을 영구 ID로 삼지 않는다. 접근 권한은 매 요청 확인 |
| Project | id, character_id, bible_version_id, preset_version_id, concept, status | 바이블/프리셋 최신 버전을 몰래 적용하지 않는다. |
| Emoji | id, project_id, order, text, emotion, action, expression, selected_variant_id | project 내 order는 고유, 선택은 자신의 후보 하나만 |
| GenerationJob | id, emoji_id, input_snapshot, provider, model, request_id, attempt, status | 요청·실패·취소·비용 기록, 원문 로그 최소화 |
| EmojiVariant | id, emoji_id, job_id, asset_id, parent_variant_id, seed | 부모는 같은 항목의 후보, 원본 보존, 순환 계보 금지 |
| PlatformPresetVersion | id, platform, type, stage, version, rules, evidence_status | source/checked_at과 함께 불변 버전 관리 |
| ValidationReport | id, project_id, snapshot_hash, preset_version_id, results | 룰별 pass/fail/unknown/warning과 검사기 버전 |
| Export | id, project_id, snapshot_hash, report_id, archive_asset_id | 검증 대상과 ZIP 대상이 같은 스냅샷 |

`users`/인증은 저장 방식 확정 후 도입한다. `owner_id`는 소유 경계 요구사항이며 특정 인증 제품을 뜻하지 않는다. Animation·Frame·MotionPlan은 MVP 3에서 추가한다.

## Character DNA의 구조

visual_dna는 종족, 체형(등신·형태·크기), 얼굴(바탕·눈무늬·눈), 역할별 색상, 소품, 선·그림 스타일을 구조화한다. 필드별 lock은 향후 선택적 확장이다. 사용자가 JSON을 편집해야 하는 UI로 만들지 않는다.

기획 속 나무늘보·초록 크로스백·2.5등신 등은 모델을 설명하는 사용자 제공 예시다. 실제 소유 자산이 등록된 것으로 취급하지 않으며 테스트에는 별도의 합성 데이터를 쓴다.

## 주요 불변 조건

1. 바이블 수정은 새 버전을 만든다. 기존 프로젝트는 명시적으로 갱신할 때만 새 버전을 사용한다.
2. 프로젝트의 현재 바이블과 후보의 생성 당시 바이블을 모두 추적한다. 갱신 후 기존 후보는 재검토 필요 상태로 표시한다.
3. 참조의 master/우선순위는 요청 구성을 위한 입력이며 일관성 정확도 수치가 아니다.
4. 하나의 항목에서 여러 후보를 보관할 수 있지만 내보내기에 선택하는 후보는 하나다.
5. 후보 생성·재시도는 선택을 자동으로 덮어쓰지 않는다. 편집 결과도 사용자 선택 전에는 새 후보다.
6. 외부에서 늦게 도착한 작업 결과는 현재 프로젝트의 선택·검사 상태를 되돌리지 않는다.
7. 삭제는 참조 관계를 확인하고 미완료 작업·내보내기 이력 처리 방식을 결정한 뒤 수행한다.

## 상태 표현

항목의 작업 상태(draft/planned/generating/needs_selection/selected/error)와 검증 상태(unchecked/pass/fail/unknown/stale)는 분리한다. 이미지가 선택됐어도 규격 검사에는 실패할 수 있다. 프로젝트 진행률은 선택 여부를 집계하며 생성 job 성공 개수와 혼동하지 않는다.
