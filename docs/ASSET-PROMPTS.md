# 프리셋과 이미지 제작 기록

## 현재 무료 프리셋: 코드로 작성한 2D 캐릭터

2026-09-30에 새 무료 라이브러리를 `server/character-art.ts`로 구현했습니다. 이 라이브러리는 SVG 경로로 얼굴·몸·팔·손·소품을 그리고 Sharp로 투명 PNG 및 프레임 시트를 렌더링합니다. **이번 32종·24종 라이브러리 제작에는 내장 `image_gen`, 이미지 생성 CLI, 외부 이미지 API를 사용하지 않았습니다.** 아래에 보존한 이전 AI 이미지 제작 기록과 출처가 다릅니다.

- 늘보군: 베이지색 몸, 크림색 얼굴·배, 갈색 눈 무늬, 머리 털, 초록 크로스백과 얼굴 배지.
- 토끼찬구: 흰 몸, 곧게 선 긴 두 귀와 분홍 귀 안쪽, 동그란 분홍 볼, 작은 눈과 활발한 비대칭 눈썹, 감정이 드러나는 입. 분홍 백팩에 당근 키링을 달고 다니며 밝고 활발하지만 조금 급한 성격이다. 늘보군을 응원하고 기다려주는 따뜻함과 “빨리 가자!!”라는 대표 문구를 유지한다.
- 공통 화풍: 투명 360×360px, 굵은 갈색 윤곽선, 따뜻한 파스텔 색, 읽기 쉬운 표정과 작은 소품.

2026-09-30의 토끼찬구 재설계는 사용자가 새로 제공한 전체 설정화를 기준으로 한다. 정식 표기는 **토끼찬구**다. `shared/character-presets.ts`에서 프리셋 이름·컨셉·성격·대표 문구를 공유하고, UI와 생성 입력이 이 정의를 사용한다. 기존의 접힌 귀·민트 스카프·당근 모양 가방은 새 설정의 기준이 아니다. 설정화 원본과 로컬 절대 경로는 저장소에 복제하지 않는다. 이번 변경은 프리셋 기본값과 신규 렌더 결과에 적용하며 기존 DB 컨셉·이미지·버전·승인을 자동 변경하지 않는다. 최신 선택 이미지는 `public/samples/characters/tokki-v2.png`를 사용하고, 기존 참조 URL이 가리키는 `tokki.png`는 그대로 보존한다.

`shared/sticker-plans.ts`에는 인사·사랑·졸음·감사·응원·사과·웃음·울음·놀람·화남·동의·거절·수긍·배고픔·간식·커피·작업·달리기·기다림·피곤함·궁금함·축하·잘 자·작별·환영·뿌듯함·수줍음·비 오는 날·아픔·운동·생일·약속의 **32개 독립 장면**이 있습니다. 각 장면의 제목, 감정, 자세 설명, 동작 설명, 기본 대사를 코드에서 공유합니다. 표정만 바꾼 동일 이미지 반복이 아니라 자세와 소품을 함께 구성합니다.

움직이는 세트는 앞의 **24개 장면**을 사용합니다. 프레임마다 연결된 팔 경로와 손 위치, 눈꺼풀·입·귀 끝을 다시 그립니다. 몸통·머리 위치·발·가방의 전체 위치를 움직이거나, 한 장을 잘라 회전하는 방식이 아닙니다. 4열×2행의 실제 8프레임을 2초 동안 재생하고 투명 WebP/GIF로 인코딩합니다. 같은 장면의 개별 수정은 준비된 표정·손 자세 변주를 선택하며, 자유 입력 피드백을 AI가 해석했다고 표시하지 않습니다.

현재 파일과 검수 자료:

| 경로                                                        | 용도                                        |
| ----------------------------------------------------------- | ------------------------------------------- |
| `public/samples/characters/neulbo.png`                      | 라이브러리와 같은 화풍의 늘보군 선택 이미지 |
| `public/samples/characters/tokki-v2.png`                    | 최신 설정화 기준 토끼찬구 선택 이미지       |
| `docs/neulbo-32-presets.png`, `docs/tokki-32-presets.png`   | 이전 디자인의 캐릭터별 정지 32종 검수       |
| `docs/neulbo-24-presets.gif`, `docs/tokki-24-presets.gif`   | 이전 디자인의 부위 동작 24종 미리보기       |
| `docs/neulbo-24-presets.webp`, `docs/tokki-24-presets.webp` | 위 동작 모음의 WebP 미리보기                |

최신 토끼찬구 검수 결과는 `npm run preview:tokki`로 재생성합니다. 격리 DB에서 실제 API로 두 세트를 생성·완료하고, `test-results/tokki-v2-preview/`에 밝음·어둠·대사 없는 32종 모음, 24개 실제 GIF/WebP, PNG/GIF/WebP ZIP, 파일 검사 JSON, 크기·배경을 전환할 수 있는 HTML을 저장합니다. 이 디렉터리는 Git에서 제외되며 Playwright가 정리할 수 있으므로 전체 QA 후 실행하세요. 다른 보관 위치는 `npm run preview:tokki -- /absolute/output/path`로 지정합니다. 테스트 DB에서만 내보내기를 위한 자동 승인을 수행하고 종료 시 해당 임시 DB를 삭제합니다.

단위 검증은 두 캐릭터의 정지 64종을 모두 렌더링해 크기·투명 여백을 확인하고, 축소한 실제 픽셀로 모든 장면 쌍의 차이를 검사합니다. 움직이는 48종도 전부 인코딩해 실제 다중 프레임, 머리·몸통의 고정 영역, 국소 픽셀 변화, 투명 여백과 용량을 검사합니다. 최종 실행 결과는 [QA 기록](QA.md)에 따로 기록합니다.

대사는 이미지 생성과 분리해 `server/captions.ts`에서 Noto Sans KR로 합성합니다. 각 버전의 깨끗한 원본에서 켜기·끄기·편집을 수행하며 AI 호출은 하지 않습니다. 폰트 원본과 라이선스는 [폰트 기록](../public/fonts/README.md)에 있습니다.

## 이전 AI 샘플 기록: 정지 6종

2026-09-30에 사용자가 제공한 늘보군 캐릭터 시트를 바탕으로 Codex 내장 `image_gen` 도구로 만든 여섯 개의 독립 PNG 이미지입니다. 원본 캐릭터 시트는 `public/samples/reference.png`에 변경 없이 복사했습니다. CLI/API 대체 생성기는 사용하지 않았습니다.

이 파일들은 이전 체험 프로젝트와 자동화 테스트에서 사용한 사전 생성 샘플입니다. 기존 데이터·버전과 처음 제공되는 6종 튜토리얼의 출처를 보존하기 위해 유지합니다. 현재 새로 생성하는 32종·24종 프리셋 라이브러리의 입력 그림이 아니며, 현재 사용자의 컨셉을 새로 생성한 결과 또는 플랫폼 심사 통과 결과로 설명하지 않습니다.

## 산출물과 검수

| 파일                        | 표현                       | 크기        | 알파 채널 |
| --------------------------- | -------------------------- | ----------- | --------- |
| `public/samples/hello.png`  | 앉아서 손을 흔드는 인사    | 1254 × 1254 | 투명 PNG  |
| `public/samples/love.png`   | 분홍 하트를 안은 애정      | 1254 × 1254 | 투명 PNG  |
| `public/samples/sleepy.png` | 손 위에 머리를 얹고 잠들기 | 1254 × 1254 | 투명 PNG  |
| `public/samples/thanks.png` | 두 손을 모은 감사          | 1254 × 1254 | 투명 PNG  |
| `public/samples/cheer.png`  | 두 주먹을 든 응원          | 1254 × 1254 | 투명 PNG  |
| `public/samples/sorry.png`  | 부끄럽게 손을 모은 사과    | 1254 × 1254 | 투명 PNG  |

모든 결과를 시각적으로 검수했습니다. 둥근 베이지색 나무늘보, 크림색 얼굴과 배, 갈색 눈 주위 무늬, 머리 털, 초록 크로스백과 늘보 배지를 유지합니다. 별도 텍스트나 워터마크가 없고 각 표현이 구분됩니다. `sharp`로 PNG 포맷, 크기, `hasAlpha: true`, 알파 범위 0–255를 확인했습니다. 도구의 원본 생성물을 복사했으며 후처리로 픽셀을 수정하지 않았습니다.

## 첫 이미지의 최종 프롬프트

`hello.png`는 원본 캐릭터 시트를 참조 이미지로 제공하고 `transparent_background: true`로 생성했습니다.

```text
Use case: illustration-story. Asset type: one professional messaging sticker, square transparent PNG, part of a cohesive six-expression set. Input image is a character identity and drawing-style reference ONLY; do not reproduce the reference sheet, panels, annotations or typography. Create exactly one full-body emoticon of the reference's original sloth character Neulbo: round pudgy warm beige/tan sloth, large creamy oval face mask, asymmetrical soft dark-brown eye patches, tiny dark oval nose, soft tiny smile, three small tufts atop the head, creamy oval belly, small cream claws, warm dark-brown hand-drawn outlines and tiny fur accent strokes. Preserve the distinctive sage-green crossbody bag with round sloth-face badge, diagonal strap. Pose: sitting comfortably with both feet visible, one arm raised gently waving hello, friendly sleepy eyes and quiet smile. Match reference proportions and gentle warm flat illustration style, polished commercial sticker finish, subtle minimal warm shading. Center a single character occupying about 78% of the square with generous clear margins; all limbs, bag and tuft fully visible. Actual transparent background alpha, no floor, no ground shadow, no scenery, no border, no white sticker outline, no text, no lettering, no watermark, no other characters or decorative props.
```

## 나머지 다섯 이미지의 최종 프롬프트

원본 캐릭터 시트와 생성한 `hello.png`를 각각 캐릭터 및 화풍 참조로 제공했습니다. 각 이미지는 독립 도구 호출로 생성했고 모두 `transparent_background: true`를 사용했습니다. 최종 프롬프트는 아래 공통 접두부 + 개별 포즈 + 공통 접미부를 순서대로 연결한 문자열입니다.

공통 접두부:

```text
Use case: illustration-story. Asset type: one professional messaging sticker, square transparent PNG, from a cohesive six-expression set. Input image 1 is the original character identity sheet; input image 2 is the approved sticker rendering style. Preserve their same original sloth character Neulbo, exact face identity, palette, creamy mask proportions, stout body, bag details and outline style. Do not reproduce a sheet, panels, lettering, or the waving pose. Exactly one full-body character: round pudgy warm beige/tan sloth, large creamy oval face mask, asymmetrical soft dark-brown eye patches, tiny dark oval nose, three small head tufts, creamy belly, small cream claws, warm dark-brown hand-drawn outlines and tiny fur accents. Keep the sage-green crossbody bag with round sloth-face badge and diagonal strap. Polished commercial sticker illustration, warm flat colors, subtle minimal shading like approved sticker.
```

개별 포즈:

`love.png`

```text
Pose: sitting with feet visible and hugging one medium soft dusty pink heart snugly in front of the belly; closed delighted eyes, tiny happy smile and faint warm cheek blush. The sage bag is partially visible beside the heart. No floating extras.
```

`sleepy.png`

```text
Pose: curled low on its belly with head resting on two soft folded hands, eyes peacefully closed, drowsy tiny smile; small bent feet visible at the sides; sage-green crossbody bag and strap visible on the back. A warm sleepy and cozy emotion. No sleep letters or symbols.
```

`thanks.png`

```text
Pose: a small polite bow while sitting, head tilted slightly forward, hands held together near chest in gratitude, eyes softly closed, gentle grateful smile. Sage crossbody bag visible at side; feet visible.
```

`cheer.png`

```text
Pose: sitting upright with two small softly clenched fists raised beside the head in quiet encouragement; smiling eyes and small joyful open smile, friendly determined energy. Short feet and sage crossbody bag fully visible. No stars or letters.
```

`sorry.png`

```text
Pose: sitting with knees drawn a little inward, two hands clasped low in front of belly in apology; head slightly bowed, eyes gently downcast, tiny embarrassed mouth and subtle dusty rose cheek blush. Sage crossbody bag visible at side. Gentle apologetic emotion, not crying.
```

공통 접미부:

```text
Center one character occupying about 78% of the square with generous clear margins. Entire head, feet, hands, bag, tuft visible. Actual transparent alpha background; no floor or ground shadow, no scenery, no border or white sticker outline, no text, no lettering, no watermark. No extra characters.
```

## 이전 AI 샘플 기록: 손 인사 1종

2026-09-30 추가. 사용자가 전체 그림의 흔들림이 아니라 팔·손목처럼 특정 부위가 움직이는 자연스러운 동작을 요청하여, `hello.png`를 참조한 **실제 자세 8개**를 내장 `image_gen` 도구로 새로 생성했습니다. `transparent_background: true`를 사용했고 원본 결과를 `public/samples/animations/wave.png`에 복사했습니다. 크기는 1774×887px, 4열×2행의 투명 PNG입니다.

생성 지시 요약:

> Same Neulbo character as the reference. Create eight consecutive hand-drawn poses in an exact four-column, two-row transparent sprite sheet. Only the raised arm on the viewer's left and its wrist/paw change pose through a gentle wave. Keep the body, head, face, bag, feet, proportions, camera and scale stationary. Preserve the three claws. Move from neutral through an outward wrist wave, back through neutral, then an inward wave and back to the starting pose. No whole-character rotation or scaling, no text, labels, frame borders or background.

이미지 모델의 결과에는 일부 몸통 위치 차이와 부적절한 팔 자세가 있었으므로 생성 결과 그대로를 완성본으로 쓰지 않았습니다. `server/frame-animation.ts`의 프레임 처리로 공통 여백과 위치를 맞추고, 팔 영역 밖은 첫 프레임의 픽셀로 고정했습니다. 새 생성 경로에서는 한 장 전체를 회전·확대·이동시키는 방식을 사용하지 않습니다.

실제 재생에는 0부터 세어 `[0, 1, 0, 4, 7, 4, 0]` 순서를 사용합니다. 2번 셀은 손끝 잘림, 3번은 팔과 머리 사이 윤곽 연결, 6번은 손과 얼굴의 겹침 때문에 제외했습니다. 5번도 최종 반복 순서에는 사용하지 않습니다. 작은 손목 인사를 2초 동안 반복하며, 첫 자세로 돌아와 다음 반복에 연결됩니다. 이전 체험 버전은 이 동작 하나를 24개 슬롯에 반복했으며, 24개의 독립 AI 동작 생성 결과가 아니었습니다. 현재 신규 세트에는 장면별로 다른 코드 기반 24종을 사용합니다.

검수 출력물:

- `docs/natural-wave.webp`: 고정부위의 픽셀을 보존하는 lossless WebP
- `docs/natural-wave.gif`: 일반 GIF 미리보기(256색·이진 투명도 특성으로 WebP와 다를 수 있음)
- `docs/natural-wave-montage.png`: 처리된 자세 확인용 프레임 시트

실제 샘플 회귀 테스트는 얼굴·몸통·가방·팔 영역 옆 이마의 RGBA가 프레임 간 동일한지, 팔 안에서는 픽셀이 실제로 바뀌는지, 바깥 여백이 투명한지 검사합니다. 생성 프레임 간 부위 연결과 표현의 자연스러움은 별도 시각 검수를 병행합니다.
