import type { BuiltinCharacter } from './types';

export interface CharacterPreset {
  id: BuiltinCharacter;
  name: string;
  concept: string;
  personality: string;
  audience: string;
  image: string;
  tagline: string;
  catchphrase: string;
}

// Defaults for an explicitly selected preset. Saved concepts and versions keep their own data.
export const CHARACTER_PRESETS: readonly CharacterPreset[] = [
  {
    id: 'neulbo',
    name: '늘보군',
    concept:
      '느긋하고 다정한 나무늘보. 포근한 갈색 털과 동그란 얼굴, 작은 가방이 특징이에요. 소소한 일상의 감정을 천천히 전해요.',
    personality: '느긋하고 다정한 말투, 엉뚱한 귀여움',
    audience: '친구와 일상을 나누는 사람',
    image: '/samples/characters/neulbo.png',
    tagline: '느려도 괜찮은 포근한 하루',
    catchphrase: '천천히 가도 돼.',
  },
  {
    id: 'tokki',
    name: '토끼찬구',
    concept:
      '흰 몸에 곧게 선 긴 두 귀와 분홍색 귀 안쪽, 동그란 분홍 볼이 있는 토끼예요. 작은 눈과 활발한 비대칭 눈썹, 표정이 잘 드러나는 입이 특징이에요. 분홍 백팩에 당근 키링을 달고 다녀요. 밝고 활발하며 조금 급하지만, 느린 친구 늘보군을 언제나 응원하고 기다려주는 따뜻한 친구예요. 대표 한마디는 “빨리 가자!!”예요.',
    personality:
      '밝고 활발하며 긍정적이에요. 조금 급하지만 늘보군을 응원하고 기다려주는 따뜻한 말투예요.',
    audience: '친구와 일상을 나누고 서로 응원하는 사람',
    image: '/samples/characters/tokki-v2.png',
    tagline: '늘보를 응원하는 활발한 친구',
    catchphrase: '빨리 가자!!',
  },
];

export const CHARACTER_CONCEPTS: Readonly<Record<BuiltinCharacter, string>> = Object.fromEntries(
  CHARACTER_PRESETS.map((preset) => [preset.id, preset.concept]),
) as Record<BuiltinCharacter, string>;

export function getCharacterPreset(id: BuiltinCharacter): CharacterPreset {
  return CHARACTER_PRESETS.find((preset) => preset.id === id)!;
}
