export type ProjectStatus = 'concept' | 'direction' | 'generating' | 'review' | 'completed';
export type StickerStatus = 'pending' | 'approved' | 'changes_requested';
export type Provider = 'sample' | 'openai';
export type ProjectFormat = 'static' | 'animated';
export type BuiltinCharacter = 'neulbo' | 'tokki';
export interface CharacterConcept {
  id: string;
  name: string;
  characterName: string;
  concept: string;
  personality: string;
  audience: string;
  referenceUrl: string | null;
  builtinCharacter: BuiltinCharacter | null;
  projectCount: number;
  stickerCount: number;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ConceptDetail extends CharacterConcept {
  projects: Project[];
}
export interface CreateConceptInput {
  name: string;
  characterName: string;
  concept: string;
  personality?: string;
  audience?: string;
  referenceUrl?: string | null;
  builtinCharacter?: BuiltinCharacter | null;
}
export type MotionPreset = 'bounce' | 'float' | 'sway' | 'pulse' | 'shake';
export interface AnimationRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface FrameAnimation {
  kind: 'frames';
  sheetUrl: string;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  sequence: number[];
  delaysMs: number[];
  actionPrompt: string;
  region: AnimationRegion | null;
  warnings?: string[];
}
export const ACTION_SUGGESTIONS = [
  {
    label: '손 인사',
    prompt:
      '몸과 얼굴, 가방, 발은 가만히 두고 한쪽 팔과 손목만 움직여 다정하게 손을 흔들어요. 처음 자세로 자연스럽게 돌아와요.',
  },
  {
    label: '눈 깜빡임',
    prompt:
      '머리와 몸은 가만히 두고 눈꺼풀만 천천히 닫았다 열어요. 눈을 뜬 원래 표정으로 자연스럽게 돌아와요.',
  },
  {
    label: '고개 끄덕임',
    prompt:
      '몸통과 가방, 발은 가만히 두고 목에서 고개만 작게 끄덕여요. 눈과 얼굴 비율을 유지하며 처음 자세로 돌아와요.',
  },
] as const;
export const KAKAO_STICKER_COUNTS: Record<ProjectFormat, number> = { static: 32, animated: 24 };
export const MOTION_PRESETS: { value: MotionPreset; label: string; description: string }[] = [
  { value: 'float', label: '둥실둥실', description: '느긋하게 떠오르는 움직임' },
  { value: 'bounce', label: '통통', description: '기분 좋게 튀어 오르는 움직임' },
  { value: 'sway', label: '갸우뚱', description: '좌우로 부드럽게 기울이는 움직임' },
  { value: 'pulse', label: '두근두근', description: '작게 커졌다 돌아오는 움직임' },
  { value: 'shake', label: '도리도리', description: '가볍게 좌우로 흔드는 움직임' },
];
export interface User {
  id: string;
  name: string;
  email: string | null;
  isGuest: boolean;
}
export interface Direction {
  id: string;
  title: string;
  description: string;
  tags: string[];
  color: string;
  prompts: string[];
}
export interface StickerVersion {
  id: string;
  version: number;
  imageUrl: string;
  posterUrl: string;
  sourceUrl: string;
  cleanImageUrl: string;
  caption: string | null;
  poseId: string | null;
  gifUrl: string | null;
  motionPreset: MotionPreset | null;
  frameCount: number;
  durationMs: number;
  animation: FrameAnimation | null;
  prompt: string;
  feedback: string | null;
  createdAt: string;
  provider: Provider;
}
export interface Sticker {
  caption: string | null;
  poseId: string | null;
  id: string;
  projectId: string;
  title: string;
  emotion: string;
  status: StickerStatus;
  imageUrl: string;
  posterUrl: string;
  gifUrl: string | null;
  motionPreset: MotionPreset | null;
  frameCount: number;
  durationMs: number;
  animation: FrameAnimation | null;
  currentVersion: number;
  feedback: string | null;
  versions: StickerVersion[];
  createdAt: string;
}
export interface Activity {
  id: string;
  type: string;
  message: string;
  createdAt: string;
}
export interface GenerationJob {
  id: string;
  projectId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  total: number;
  requestedCount?: number;
  completed: number;
  error: string | null;
  createdAt: string;
}
export interface Project {
  conceptId: string;
  builtinCharacter: BuiltinCharacter | null;
  captionsEnabled: boolean;
  id: string;
  name: string;
  characterName: string;
  concept: string;
  personality: string;
  audience: string;
  referenceUrl: string | null;
  direction: Direction | null;
  status: ProjectStatus;
  provider: Provider;
  stickerCount: number;
  format: ProjectFormat;
  targetCount: number;
  isLegacy: boolean;
  motionPreset: MotionPreset;
  actionPrompt: string;
  approvedCount: number;
  containsPresetSamples?: boolean;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface ProjectDetail extends Project {
  stickers: Sticker[];
  activities: Activity[];
  job: GenerationJob | null;
}
export interface Bootstrap {
  concepts: CharacterConcept[];
  user: User;
  projects: Project[];
  capabilities: { liveGeneration: boolean; imageModel: string; sampleCount: number };
}
export interface CreateProjectInput {
  conceptId?: string;
  builtinCharacter?: BuiltinCharacter | null;
  captionsEnabled?: boolean;
  name: string;
  characterName: string;
  concept: string;
  personality?: string;
  audience?: string;
  referenceUrl?: string | null;
  format?: ProjectFormat;
  motionPreset?: MotionPreset;
  actionPrompt?: string;
}
