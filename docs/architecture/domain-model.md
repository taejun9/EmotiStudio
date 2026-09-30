# 도메인 모델

## 현재 구현

현재 TypeScript 계약은 [shared/types.ts](../../shared/types.ts), SQLite 스키마와 마이그레이션은 [server/db.ts](../../server/db.ts), HTTP 동작은 [API 계약](../API-CONTRACT.md)을 기준으로 한다.

| 모델             | 주요 데이터                                                                         | 관계·조건                                                        |
| ---------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| User / 세션      | id, name, email, isGuest / 해시된 세션 토큰                                         | 게스트 또는 등록 계정; 자산·컨셉·세트 접근 시 소유권 검사        |
| CharacterConcept | name, characterName, concept, personality, audience, referenceUrl, builtinCharacter | 한 부모 컨셉에 여러 세트; 하위 세트가 있으면 부모 삭제 불가      |
| Project          | conceptId, 복사된 캐릭터 정보, direction, format, targetCount, status               | 생성 시 부모 정보를 복사; 부모 수정이 기존 세트를 덮어쓰지 않음  |
| Direction        | title, description, tags, color, prompts                                            | 규칙 기반 제안 또는 사용자가 작성한 방향성                       |
| Sticker          | projectId, title, emotion, status, currentVersion, feedback                         | 세트의 한 항목; 현재 버전과 이전 버전 목록 제공                  |
| StickerVersion   | version, provider, prompt, feedback, 이미지 URL, caption, poseId                    | 생성·수정·대사 합성 결과 보관; 복원 시 새 버전들을 삭제하지 않음 |
| FrameAnimation   | sheetUrl, grid, sequence, delaysMs, actionPrompt, region                            | 정지 이미지에서는 null; 프레임 시트와 타임라인은 별도 데이터     |
| GenerationJob    | projectId, status, total, requestedCount, completed, error                          | 현재 작업 진행률·부분 실패 보관; 재시도는 누락 항목 채움         |
| Activity         | type, message, createdAt                                                            | 세트 작업 이력                                                   |

새 세트 수량은 서버에서 정지 32개·움직이는 24개로 정한다. 이전 세트는 원래 수량과 `isLegacy` 표시를 보존한다. 이 수량은 전체 플랫폼 제출 요건을 의미하지 않는다. `motionPreset`은 이전 데이터 호환 필드이며 한 장 전체를 변형하는 생성 API는 폐기 상태다.

버전의 `imageUrl`은 표시·내보내기 결과, `posterUrl`은 정지 미리보기, `sourceUrl`은 독립 캐릭터 참조, `cleanImageUrl`은 대사 없는 PNG 또는 프레임 시트다. 대사와 프레임 메타데이터를 버전별로 보존한다. 이미지 URL만으로 소유권을 인정하지 않으며 API가 접근 권한을 검사한다.

## 현재 상태와 불변 조건

- 프로젝트: `concept/direction/generating/review/completed`.
- 항목 검수: `pending/approved/changes_requested`.
- 생성 작업: `queued/running/completed/failed`.
- 완료에는 목표 수량과 전체 승인이 필요하다. 수정하려면 다시 검수 상태로 연다.
- 이미지·동작 수정 및 버전 복원은 승인을 해제한다. 부분 생성이 남은 배치는 먼저 완료해야 한다.
- 부모 컨셉을 다른 것으로 바꾸지 않는다. 이미지가 있으면 세트 형식과 내장 캐릭터도 고정한다.
- 세트 삭제 시 다른 컨셉·세트·버전에서 사용하는 파일을 보존한다.

현재 모델에는 독립된 `ValidationReport`, 규격 검증의 `unknown/stale` 상태, 범용 후보 선택·부모 후보 ID가 없다. 현재 버전 포인터와 사용자 승인 상태를 이러한 미래 모델과 혼동하지 않는다.

## 후속 논리 모델

아래는 원래 기획의 목표이며 현재 DB/API 스키마가 아니다. 구현 시 기존 컨셉·세트·버전 데이터의 마이그레이션을 별도 계획에 포함한다.

| 목표 모델                  | 설계 의도                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------- |
| CharacterBibleVersion      | 구조화된 visual_dna·style_prompt의 불변 버전; 프로젝트가 사용할 버전을 명시적으로 선택 |
| CharacterReference / Asset | 다중 참조의 view_type·master·우선순위, 파일 해시·보관 키·권리 확인 기록                |
| Emoji / EmojiVariant       | 항목별 문구·감정·행동·표정, 여러 후보와 선택 후보, 동일 항목 내 부모 계보              |
| Generation input snapshot  | 바이블·참조·프롬프트 버전, 공급자·모델·요청·시도·비용·선택적 seed                      |
| PlatformPresetVersion      | 단계별 규칙, 출처·확인일·근거 상태를 가진 불변 규격 버전                               |
| ValidationReport / Export  | 선택 결과와 규격의 스냅샷 해시, 룰별 결과, 실제 내보낸 파일과의 연결                   |

Character DNA는 종족·체형·얼굴·색·소품·선 스타일을 구조화하되 사용자가 JSON을 직접 편집하는 UI를 요구하지 않는다. 바이블 갱신 시 이전 후보의 생성 버전을 보존하고 재검토 상태를 표시한다. 늦은 작업 결과가 현재 선택을 덮어쓰지 않도록 하며, 규격·선택 변경은 검사 보고서를 stale로 만든다. Reference Lock과 AI 일관성 점수는 정확도 보장이 아니다.
