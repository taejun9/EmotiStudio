import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  CopyCheck,
  Ellipsis,
  FolderHeart,
  Film,
  Grid2X2,
  Image as ImageIcon,
  ImagePlus,
  Layers3,
  LoaderCircle,
  LogOut,
  Menu,
  MessageCircle,
  Pencil,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import type {
  Bootstrap,
  CreateProjectInput,
  CharacterConcept,
  ConceptDetail,
  CreateConceptInput,
  BuiltinCharacter,
  Direction,
  Project,
  ProjectDetail,
  Provider,
  Sticker,
  FrameAnimation,
  AnimationRegion,
  ProjectFormat,
} from '../shared/types';
import { KAKAO_STICKER_COUNTS, ACTION_SUGGESTIONS } from '../shared/types';

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    let message = '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';
    try {
      const body = await response.json();
      if (body.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  return response.json();
}
const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const statuses: Record<string, string> = {
  concept: '컨셉 작성 중',
  direction: '방향 선택 중',
  generating: '생성 중',
  review: '검수 중',
  completed: '완료',
};
const emotions: Record<string, string> = {
  pending: '검수 대기',
  approved: '승인 완료',
  changes_requested: '수정 요청',
};
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '연결을 확인하고 다시 시도해 주세요.';
const date = (value: string) =>
  new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' }).format(new Date(value));
const containsSamples = (project: ProjectDetail) =>
  project.stickers.some(
    (sticker) =>
      sticker.versions.find((version) => version.version === sticker.currentVersion)?.provider ===
      'sample',
  );
const sampleDescription = (project: ProjectDetail) => {
  const samples = project.stickers.filter(
    (sticker) =>
      sticker.versions.find((version) => version.version === sticker.currentVersion)?.provider ===
      'sample',
  );
  return [
    samples.some((sticker) => sticker.poseId)
      ? '캐릭터 프리셋으로 만든 서로 다른 상황과 포즈예요. 자유로운 컨셉 해석은 AI 연결이 필요해요.'
      : '',
    samples.some((sticker) => !sticker.poseId)
      ? '이전 버전의 예제 이미지가 포함돼 있어요. 새 캐릭터 프리셋과 구분해 확인해 주세요.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
};
const CHARACTER_PRESETS: {
  id: BuiltinCharacter;
  name: string;
  concept: string;
  personality: string;
  audience: string;
  image: string;
}[] = [
  {
    id: 'neulbo',
    name: '늘보군',
    concept:
      '느긋하고 다정한 나무늘보. 포근한 갈색 털과 동그란 얼굴, 작은 가방이 특징이에요. 소소한 일상의 감정을 천천히 전해요.',
    personality: '느긋하고 다정한 말투, 엉뚱한 귀여움',
    audience: '친구와 일상을 나누는 사람',
    image: '/samples/characters/neulbo.png',
  },
  {
    id: 'tokki',
    name: '토끼찬구',
    concept:
      '아이보리색 토끼. 한쪽 귀가 접혀 있고 민트 스카프와 당근 가방을 메고 있어요. 다정하지만 장난기 많은 친구의 일상을 표현해요.',
    personality: '다정하지만 장난기 많은 친구, 짧고 친근한 말투',
    audience: '친구와 즐거운 일상을 나누는 사람',
    image: '/samples/characters/tokki.png',
  },
];
const isBusyJob = (project: ProjectDetail) =>
  project.job?.status === 'queued' || project.job?.status === 'running';
const formatLabel = (format: ProjectFormat) =>
  format === 'animated' ? '움직이는 이모티콘' : '정지 이모티콘';
const DEFAULT_ACTION = ACTION_SUGGESTIONS[0].prompt;
const ARM_REGION: AnimationRegion = { x: 0.08, y: 0.18, width: 0.38, height: 0.6 };
const animationLabel = (sticker: Sticker) =>
  sticker.animation ? '동작 프레임' : sticker.motionPreset ? '이전 방식 · 전체 움직임' : '움직임';

function useMotionPlayback() {
  const [playing, setPlaying] = useState(
    () => !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => {
      if (preference.matches) setPlaying(false);
    };
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);
  return { playing, setPlaying, toggle: () => setPlaying((previous) => !previous) };
}

function LegacyAnimatedPreview({ sticker }: { sticker: Sticker }) {
  const { playing, toggle } = useMotionPlayback();
  const animated = sticker.frameCount > 1;
  return (
    <div className="animated-preview">
      <img
        src={animated && !playing ? sticker.posterUrl : sticker.imageUrl}
        alt={sticker.title}
        data-playing={animated && playing}
      />
      {animated && (
        <button
          type="button"
          className="motion-play-button"
          onClick={toggle}
          aria-label={`${sticker.title} ${playing ? '일시정지' : '재생'}`}
          aria-pressed={playing}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
          <span>{playing ? '일시정지' : '재생'}</span>
        </button>
      )}
    </div>
  );
}

function FrameTile({
  animation,
  frame,
  label,
  className = '',
}: {
  animation: FrameAnimation;
  frame: number;
  label?: string;
  className?: string;
}) {
  const column = frame % animation.columns;
  const row = Math.floor(frame / animation.columns);
  const style: CSSProperties = {
    aspectRatio: `${animation.frameWidth} / ${animation.frameHeight}`,
    backgroundImage: `url("${animation.sheetUrl}")`,
    backgroundSize: `${animation.columns * 100}% ${animation.rows * 100}%`,
    backgroundPosition: `${animation.columns > 1 ? (column / (animation.columns - 1)) * 100 : 0}% ${animation.rows > 1 ? (row / (animation.rows - 1)) * 100 : 0}%`,
  };
  return (
    <div
      className={`frame-tile ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={style}
      data-frame={frame}
    />
  );
}

function FramePlayer({
  sticker,
  onFrameChange,
}: {
  sticker: Sticker;
  onFrameChange?: (frame: number) => void;
}) {
  const animation = sticker.animation!;
  const sequence = animation.sequence.length
    ? animation.sequence
    : Array.from({ length: animation.frameCount }, (_, index) => index);
  const { playing, setPlaying, toggle } = useMotionPlayback();
  const [position, setPosition] = useState(0);
  const [compare, setCompare] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const positionRef = useRef(position);
  positionRef.current = position;
  useEffect(() => {
    let cancelled = false;
    const sheet = new Image();
    setLoaded(false);
    setLoadError(false);
    sheet.onload = () => {
      if (!cancelled) setLoaded(true);
    };
    sheet.onerror = () => {
      if (!cancelled) {
        setLoadError(true);
        setPlaying(false);
      }
    };
    sheet.src = animation.sheetUrl;
    return () => {
      cancelled = true;
    };
  }, [animation.sheetUrl, retry]);
  useEffect(() => {
    if (!playing || !loaded || sequence.length < 2) return;
    let id = 0;
    let last = performance.now();
    let elapsed = 0;
    const tick = (time: number) => {
      elapsed += Math.min(time - last, 250);
      last = time;
      let next = positionRef.current;
      let advanced = false;
      let guard = 0;
      while (elapsed >= (animation.delaysMs[next] || 100) && guard < sequence.length) {
        elapsed -= animation.delaysMs[next] || 100;
        next = (next + 1) % sequence.length;
        advanced = true;
        guard++;
      }
      if (advanced) {
        positionRef.current = next;
        setPosition(next);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, loaded, animation, sequence.length]);
  const seek = (frame: number) => {
    setPlaying(false);
    const next = Math.max(0, Math.min(sequence.length - 1, frame));
    positionRef.current = next;
    setPosition(next);
    onFrameChange?.(next);
  };
  return (
    <div className="frame-player">
      <div className="frame-stage transparency-grid">
        {loaded ? (
          <FrameTile
            animation={animation}
            frame={sequence[position] ?? 0}
            label={`${sticker.title} 프레임 ${position + 1}`}
          />
        ) : (
          <img src={sticker.posterUrl} alt={sticker.title} />
        )}
        <span className="frame-position">
          {position + 1} / {sequence.length}
        </span>
        {!loaded && !loadError && (
          <span className="frame-load">
            <LoaderCircle size={20} className="spin" />
          </span>
        )}
      </div>
      {loadError && (
        <ErrorNotice
          message="프레임을 불러오지 못했어요."
          retry={() => setRetry((value) => value + 1)}
        />
      )}
      <div className="frame-playback-controls">
        <button
          type="button"
          className="icon-button"
          aria-label="이전 프레임"
          onClick={() => seek(position - 1)}
          disabled={!loaded || position === 0}
        >
          <ChevronLeft size={19} />
        </button>
        <button
          type="button"
          className="frame-play-toggle"
          aria-label={`${sticker.title} ${playing ? '일시정지' : '재생'}`}
          aria-pressed={playing}
          disabled={!loaded}
          onClick={toggle}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
          {playing ? '일시정지' : '재생'}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="다음 프레임"
          onClick={() => seek(position + 1)}
          disabled={!loaded || position === sequence.length - 1}
        >
          <ChevronRight size={19} />
        </button>
        <span>
          {(
            (animation.delaysMs.reduce((sum, value) => sum + value, 0) || sticker.durationMs) / 1000
          ).toFixed(1)}
          초 루프
        </span>
      </div>
      <label className="frame-slider-label">
        <span>
          프레임 살펴보기{' '}
          <strong>
            {position + 1} / {sequence.length}
          </strong>
        </span>
        <input
          type="range"
          aria-label="프레임 선택"
          aria-valuetext={`프레임 ${position + 1} / ${sequence.length}`}
          min={0}
          max={Math.max(0, sequence.length - 1)}
          step={1}
          value={position}
          disabled={!loaded}
          onChange={(event) => seek(Number(event.target.value))}
        />
      </label>
      <div className="frame-filmstrip" role="group" aria-label="프레임 목록">
        {sequence.map((frame, index) => (
          <button
            type="button"
            key={index}
            className={position === index ? 'selected' : ''}
            aria-label={`${index + 1}번 프레임 보기`}
            aria-pressed={position === index}
            disabled={!loaded}
            onClick={() => seek(index)}
          >
            <FrameTile animation={animation} frame={frame} />
            <span>{String(index + 1).padStart(2, '0')}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="loop-compare-toggle"
        aria-expanded={compare}
        onClick={() => {
          setCompare(!compare);
          setPlaying(false);
        }}
      >
        <CopyCheck size={15} />
        첫·마지막 프레임 비교
        <ChevronDown size={16} />
      </button>
      {compare && (
        <div className="loop-comparison">
          <div>
            <FrameTile animation={animation} frame={sequence[0] ?? 0} label="첫 프레임" />
            <span>첫 프레임</span>
          </div>
          <ArrowLeft size={17} />
          <div>
            <FrameTile
              animation={animation}
              frame={sequence[sequence.length - 1] ?? 0}
              label="마지막 프레임"
            />
            <span>마지막 프레임</span>
          </div>
          <p>손과 얼굴의 위치가 시작으로 자연스럽게 이어지는지 확인해 주세요.</p>
        </div>
      )}
    </div>
  );
}

function ActionInput({
  value,
  onChange,
  disabled = false,
  label = '원하는 동작',
  onSuggestion,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  onSuggestion?: (index: number) => void;
}) {
  return (
    <div className="action-input">
      <label>
        {label}
        <textarea
          value={value}
          rows={3}
          maxLength={1000}
          minLength={5}
          required={!disabled}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="예: 몸과 얼굴은 가만히 두고 오른팔로 손을 두 번 흔든 뒤 처음 자세로 돌아와요."
        />
      </label>
      <div className="action-suggestions" role="group" aria-label="동작 추천">
        {ACTION_SUGGESTIONS.map((suggestion, index) => (
          <button
            type="button"
            key={suggestion.label}
            disabled={disabled}
            aria-pressed={value === suggestion.prompt}
            onClick={() => {
              onChange(suggestion.prompt);
              onSuggestion?.(index);
            }}
          >
            {suggestion.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RegionEditor({
  sticker,
  value,
  onChange,
  disabled = false,
}: {
  sticker: Sticker;
  value: AnimationRegion | null;
  onChange: (value: AnimationRegion | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [coordinates, setCoordinates] = useState(false);
  const point = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };
  const draw = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || disabled) return;
    const end = point(event);
    const x = Math.min(0.98, drag.current.x, end.x);
    const y = Math.min(0.98, drag.current.y, end.y);
    onChange({
      x,
      y,
      width: Math.max(0.02, Math.min(1 - x, Math.abs(end.x - drag.current.x))),
      height: Math.max(0.02, Math.min(1 - y, Math.abs(end.y - drag.current.y))),
    });
  };
  const updateCoordinate = (key: keyof AnimationRegion, percent: number) => {
    const next = { ...(value ?? ARM_REGION), [key]: Math.max(0, Math.min(1, percent / 100)) };
    next.width = Math.max(0.02, Math.min(next.width, 1 - next.x));
    next.height = Math.max(0.02, Math.min(next.height, 1 - next.y));
    next.x = Math.min(next.x, 1 - next.width);
    next.y = Math.min(next.y, 1 - next.height);
    onChange(next);
  };
  return (
    <div className={`region-editor ${open ? 'expanded' : ''}`}>
      <button
        type="button"
        className="region-toggle"
        onClick={() => setOpen(!open)}
        aria-label="움직일 영역 확인"
        aria-expanded={open}
      >
        <Pencil size={15} />
        <span>
          움직일 영역 확인{' '}
          <small>
            {disabled
              ? '프리셋에 맞춘 영역 사용'
              : value
                ? '선택 영역 밖은 첫 프레임 고정'
                : '영역 제한 없음'}
          </small>
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="region-content">
          {disabled ? (
            <p className="field-hint">
              프리셋은 상황별로 움직일 부위를 정해두었어요. 직접 영역과 동작을 지정하려면 AI 부위
              동작을 선택해 주세요.
            </p>
          ) : (
            <>
              <div
                className="region-canvas"
                role="group"
                aria-label="움직일 영역 미리보기"
                tabIndex={0}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  drag.current = point(event);
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={draw}
                onPointerUp={(event) => {
                  draw(event);
                  drag.current = null;
                }}
                onPointerCancel={() => {
                  drag.current = null;
                }}
                onKeyDown={(event) => {
                  if (
                    !value ||
                    !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  onChange({
                    ...value,
                    x: Math.max(
                      0,
                      Math.min(
                        1 - value.width,
                        value.x +
                          (event.key === 'ArrowLeft'
                            ? -0.01
                            : event.key === 'ArrowRight'
                              ? 0.01
                              : 0),
                      ),
                    ),
                    y: Math.max(
                      0,
                      Math.min(
                        1 - value.height,
                        value.y +
                          (event.key === 'ArrowUp' ? -0.01 : event.key === 'ArrowDown' ? 0.01 : 0),
                      ),
                    ),
                  });
                }}
              >
                {sticker.animation ? (
                  <FrameTile
                    animation={{
                      ...sticker.animation,
                      sheetUrl:
                        sticker.versions.find(
                          (version) => version.version === sticker.currentVersion,
                        )?.cleanImageUrl || sticker.animation.sheetUrl,
                    }}
                    frame={sticker.animation.sequence[0] ?? 0}
                    label="영역을 선택할 캐릭터"
                  />
                ) : (
                  <img
                    src={
                      sticker.versions.find((version) => version.version === sticker.currentVersion)
                        ?.cleanImageUrl || sticker.posterUrl
                    }
                    alt="영역을 선택할 캐릭터"
                    draggable={false}
                  />
                )}
                {value && (
                  <span
                    className="region-selection"
                    style={{
                      left: `${value.x * 100}%`,
                      top: `${value.y * 100}%`,
                      width: `${value.width * 100}%`,
                      height: `${value.height * 100}%`,
                    }}
                  >
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </div>
              <div className="region-quick-actions">
                <button type="button" onClick={() => onChange(ARM_REGION)}>
                  화면 왼쪽 팔
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ x: 0.54, y: 0.18, width: 0.38, height: 0.6 })}
                >
                  화면 오른쪽 팔
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ x: 0.24, y: 0.2, width: 0.52, height: 0.3 })}
                >
                  눈 주변
                </button>
                <button type="button" onClick={() => onChange(null)}>
                  영역 제한 해제
                </button>
              </div>
              <p className="field-hint">
                대사를 제외한 캐릭터에서 움직일 부위를 지정해요. 드래그하거나 방향키로 영역을 옮길
                수 있어요. 영역 밖은 <strong>새로 생성된 첫 프레임</strong>으로 고정해요. 새 그림이
                원본과 다를 수 있으니 생성 후 확인해 주세요.
              </p>
              {!value && (
                <p className="region-warning">
                  영역 제한을 해제하면 전체 그림이 다시 그려질 수 있어요.
                </p>
              )}
              <button
                type="button"
                className="text-button"
                onClick={() => setCoordinates(!coordinates)}
                aria-expanded={coordinates}
              >
                좌표로 영역 조정
              </button>
              {coordinates && (
                <div className="region-coordinate-fields">
                  {(
                    [
                      ['x', '가로 위치'],
                      ['y', '세로 위치'],
                      ['width', '너비'],
                      ['height', '높이'],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label} (%)
                      <input
                        type="number"
                        min={key === 'width' || key === 'height' ? 2 : 0}
                        max={100}
                        step={1}
                        value={Math.round((value ?? ARM_REGION)[key] * 100)}
                        onChange={(event) => updateCoordinate(key, Number(event.target.value))}
                      />
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StickerReviewCard({
  sticker,
  index,
  busy,
  onSelect,
}: {
  sticker: Sticker;
  index: number;
  busy: boolean;
  onSelect: () => void;
}) {
  const { playing, toggle } = useMotionPlayback();
  const animated = sticker.frameCount > 1;
  return (
    <article className={`sticker-card ${sticker.status} ${animated ? 'animated' : ''}`}>
      <button
        className="sticker-open"
        onClick={onSelect}
        disabled={busy}
        aria-label={`${sticker.title} 검수`}
      >
        <div className="sticker-card-art">
          <span className="sticker-number">{String(index + 1).padStart(2, '0')}</span>
          <img
            src={animated && !playing ? sticker.posterUrl : sticker.imageUrl}
            alt={sticker.title}
            loading="lazy"
            data-playing={animated && playing}
          />
          {sticker.status === 'approved' && (
            <span className="approval-check">
              <Check size={15} />
            </span>
          )}
          {!animated && (
            <span className="sticker-hover">
              <Search size={17} />
              자세히 보기
            </span>
          )}
        </div>
        <div className="sticker-card-info">
          <div>
            <h3>{sticker.title}</h3>
            <span>{sticker.emotion}</span>
          </div>
          <span className="mini-status">
            {emotions[sticker.status]}
            <small>
              {sticker.versions.find((version) => version.version === sticker.currentVersion)
                ?.provider === 'sample'
                ? sticker.poseId
                  ? '캐릭터 프리셋'
                  : '이전 예제'
                : 'AI 생성'}
            </small>
          </span>
        </div>
      </button>
      {animated && (
        <div className="sticker-motion-bar">
          <span>
            <Film size={12} />
            {animationLabel(sticker)}
          </span>
          <button
            type="button"
            onClick={toggle}
            aria-label={`${sticker.title} ${playing ? '일시정지' : '재생'}`}
            aria-pressed={playing}
          >
            {playing ? <Pause size={13} /> : <Play size={13} />}
            <span>{playing ? '일시정지' : '재생'}</span>
          </button>
        </div>
      )}
    </article>
  );
}

function SlothMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`sloth-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <span />
      <i />
      <b />
    </span>
  );
}
function Spinner({ label = '불러오는 중' }: { label?: string }) {
  return (
    <span className="loading-inline" role="status">
      <LoaderCircle className="spin" size={18} />
      {label}
    </span>
  );
}
function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-notice" role="alert">
      <span>{message}</span>
      {retry && (
        <button className="text-button" onClick={retry}>
          다시 시도
        </button>
      )}
    </div>
  );
}
function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <span className="badge-dot" />
      {statuses[status] ?? emotions[status] ?? status}
    </span>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const element = panel.current;
    const focusables = () =>
      [
        ...(element?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]',
        ) ?? []),
      ].filter((el) => el.offsetParent !== null);
    focusables()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
      if (event.key === 'Tab') {
        const items = focusables();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) {
          event.preventDefault();
          element?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      before?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal ${wide ? 'modal-wide' : ''}`}
      >
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="닫기">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConceptForm({
  project,
  onSave,
  onClose,
}: {
  project?: ProjectDetail;
  onSave: (input: CreateProjectInput) => Promise<void>;
  onClose: () => void;
}) {
  const [input, setInput] = useState<CreateProjectInput>({
    name: project?.name ?? '',
    characterName: project?.characterName ?? '',
    concept: project?.concept ?? '',
    personality: project?.personality ?? '',
    audience: project?.audience ?? '',
    referenceUrl: project?.referenceUrl ?? null,
    format: project?.format ?? 'static',
    actionPrompt: project?.actionPrompt || DEFAULT_ACTION,
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const update = (key: keyof CreateProjectInput, value: string) =>
    setInput((previous) => ({ ...previous, [key]: value }));
  const upload = async (file?: File) => {
    if (!file) return;
    setError('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('PNG, JPG, WebP 이미지를 선택해 주세요.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('10MB 이하의 이미지를 선택해 주세요.');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const result = await api<{ url: string }>('/uploads', { method: 'POST', body: form });
      setInput((previous) => ({ ...previous, referenceUrl: result.url }));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave(input);
    } catch (error) {
      setError(errorMessage(error));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={project ? '컨셉 수정' : '어떤 캐릭터를 만나볼까요?'}
      onClose={() => {
        if (!busy && !uploading) onClose();
      }}
      wide
    >
      <p className="modal-intro">작은 아이디어 하나면 충분해요. 캐릭터의 이야기를 들려주세요.</p>
      <form onSubmit={submit}>
        <fieldset className="format-fieldset" disabled={busy || uploading}>
          <legend>어떤 이모티콘을 만들까요?</legend>
          <div className="format-options">
            {(['static', 'animated'] as const).map((format) => (
              <label
                className={`format-option ${input.format === format ? 'selected' : ''}`}
                key={format}
              >
                <input
                  type="radio"
                  name="project-format"
                  value={format}
                  checked={input.format === format}
                  onChange={() => setInput((previous) => ({ ...previous, format }))}
                  aria-label={`${formatLabel(format)} ${KAKAO_STICKER_COUNTS[format]}개`}
                />
                <span className="format-option-icon">
                  {format === 'animated' ? <Film size={22} /> : <ImageIcon size={22} />}
                </span>
                <span>
                  <strong>{formatLabel(format)}</strong>
                  <small>
                    {format === 'animated'
                      ? '작은 움직임으로 더 생생하게'
                      : '한 장에 담는 선명한 감정'}
                  </small>
                </span>
                <b>
                  {KAKAO_STICKER_COUNTS[format]}
                  <small>개</small>
                </b>
              </label>
            ))}
          </div>
          <p className="format-count-note">카카오 기준 수량 · 정지 32개 / 움직이는 24개</p>
          <p className="field-hint">
            제안 가능 여부는 수량 외에도 플랫폼의 생성형 AI 활용 제한 등 별도 운영정책을 확인해야
            해요.
          </p>
          {input.format === 'animated' && (
            <div className="initial-action-setting">
              <ActionInput
                value={input.actionPrompt ?? DEFAULT_ACTION}
                onChange={(actionPrompt) => setInput((previous) => ({ ...previous, actionPrompt }))}
                disabled={busy || uploading}
              />
              <p className="field-hint">
                움직일 부위와 가만히 둘 부위를 함께 적어주세요. 자유 동작은 AI 연결이 필요해요.
                캐릭터 프리셋은 상황별로 준비된 포즈와 동작을 사용해요.
              </p>
            </div>
          )}
        </fieldset>
        <div className="concept-form">
          <div className="form-fields">
            <label>
              프로젝트 이름<span className="required">*</span>
              <input
                required
                maxLength={100}
                value={input.name}
                onChange={(e) => update('name', e.target.value)}
                placeholder="예: 늘보군의 느긋한 하루"
              />
            </label>
            <label>
              캐릭터 이름<span className="required">*</span>
              <input
                required
                maxLength={60}
                value={input.characterName}
                onChange={(e) => update('characterName', e.target.value)}
                placeholder="예: 늘보군"
              />
            </label>
            <label>
              캐릭터 컨셉<span className="required">*</span>
              <textarea
                required
                minLength={5}
                maxLength={3000}
                rows={4}
                value={input.concept}
                onChange={(e) => update('concept', e.target.value)}
                placeholder="예: 매일 졸리지만 친구들에게는 다정한 나무늘보. 작은 일상의 감정을 느긋하게 전해요."
              />
              <span className="field-hint">
                모습, 특징, 세계관을 자유롭게 적어주세요. (5자 이상)
              </span>
            </label>
            <div className="form-two">
              <label>
                성격과 말투
                <input
                  maxLength={500}
                  value={input.personality}
                  onChange={(e) => update('personality', e.target.value)}
                  placeholder="느긋하고 다정해요"
                />
              </label>
              <label>
                주요 사용 대상
                <input
                  maxLength={300}
                  value={input.audience}
                  onChange={(e) => update('audience', e.target.value)}
                  placeholder="친구와 일상을 나누는 사람"
                />
              </label>
            </div>
          </div>
          <div className="reference-column">
            <span className="field-label">
              참고 이미지 <span className="optional">선택</span>
            </span>
            <label className={`upload-zone ${input.referenceUrl ? 'has-image' : ''}`}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="참고 이미지"
                disabled={uploading || busy}
                onChange={(e) => {
                  void upload(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {uploading ? (
                <Spinner label="이미지 업로드 중" />
              ) : input.referenceUrl ? (
                <>
                  <img src={input.referenceUrl} alt="캐릭터 참고 이미지 미리보기" />
                  <span className="replace-image">
                    <ImagePlus size={16} />
                    이미지 바꾸기
                  </span>
                </>
              ) : (
                <>
                  <span className="upload-icon">
                    <ImagePlus size={26} strokeWidth={1.5} />
                  </span>
                  <strong>캐릭터를 보여주세요</strong>
                  <span>클릭해서 이미지 업로드</span>
                  <small>PNG, JPG, WebP · 최대 10MB</small>
                </>
              )}
            </label>
            {input.referenceUrl && (
              <button
                type="button"
                className="text-button muted"
                onClick={() => setInput((previous) => ({ ...previous, referenceUrl: null }))}
              >
                이미지 제거
              </button>
            )}
            <div className="tip-box">
              <Sparkles size={17} />
              <p>정면 모습이 잘 보이는 이미지는 캐릭터의 특징을 유지하는 데 도움이 돼요.</p>
            </div>
          </div>
        </div>
        {error && <ErrorNotice message={error} />}
        <div className="modal-footer">
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={busy || uploading}
          >
            취소
          </button>
          <button className="button primary" disabled={busy || uploading}>
            {busy ? (
              <Spinner label="저장 중" />
            ) : (
              <>
                {project ? '컨셉 저장' : '프로젝트 만들기'}
                <ArrowRight size={17} />
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CharacterConceptForm({
  concept,
  onSave,
  onClose,
}: {
  concept?: CharacterConcept;
  onSave: (input: CreateConceptInput) => Promise<void>;
  onClose: () => void;
}) {
  const [input, setInput] = useState<CreateConceptInput>({
    name: concept?.name ?? '',
    characterName: concept?.characterName ?? '',
    concept: concept?.concept ?? '',
    personality: concept?.personality ?? '',
    audience: concept?.audience ?? '',
    referenceUrl: concept?.referenceUrl ?? null,
    builtinCharacter: concept?.builtinCharacter ?? null,
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const choose = (id: BuiltinCharacter | null) => {
    const preset = CHARACTER_PRESETS.find((item) => item.id === id);
    setInput(
      preset
        ? {
            name: `${preset.name}의 이야기`,
            characterName: preset.name,
            concept: preset.concept,
            personality: preset.personality,
            audience: preset.audience,
            builtinCharacter: id,
            referenceUrl: null,
          }
        : {
            name: '',
            characterName: '',
            concept: '',
            personality: '',
            audience: '',
            builtinCharacter: null,
            referenceUrl: null,
          },
    );
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setError('10MB 이하의 PNG, JPG, WebP 이미지를 선택해 주세요.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('file', file);
      const { url } = await api<{ url: string }>('/uploads', { method: 'POST', body: form });
      setInput((previous) => ({ ...previous, referenceUrl: url }));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };
  return (
    <Modal
      title={concept ? '캐릭터 컨셉 수정' : '어떤 캐릭터를 만나볼까요?'}
      onClose={() => {
        if (!busy && !uploading) onClose();
      }}
      wide
    >
      <p className="modal-intro">
        캐릭터의 이야기를 한 번 정해두면, 그 아래에 여러 이모티콘 세트를 만들 수 있어요.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            await onSave(input);
          } catch (error) {
            setError(errorMessage(error));
            setBusy(false);
          }
        }}
      >
        <fieldset className="character-preset-picker" disabled={busy || uploading}>
          <legend>캐릭터 선택</legend>
          <div>
            {CHARACTER_PRESETS.map((preset) => (
              <label
                key={preset.id}
                className={input.builtinCharacter === preset.id ? 'selected' : ''}
              >
                <input
                  type="radio"
                  name="character-preset"
                  aria-label={preset.name}
                  checked={input.builtinCharacter === preset.id}
                  onChange={() => choose(preset.id)}
                />
                <img
                  src={preset.image}
                  alt=""
                  onError={(event) => {
                    event.currentTarget.style.visibility = 'hidden';
                  }}
                />
                <strong>{preset.name}</strong>
                <span>
                  {preset.id === 'tokki'
                    ? '장난기 가득한 다정한 친구'
                    : '느려도 괜찮은 포근한 하루'}
                </span>
              </label>
            ))}
            <label className={input.builtinCharacter === null ? 'selected' : ''}>
              <input
                type="radio"
                name="character-preset"
                aria-label="직접 입력"
                checked={input.builtinCharacter === null}
                onChange={() => choose(null)}
              />
              <span className="custom-character-icon">
                <Pencil size={31} />
              </span>
              <strong>직접 입력</strong>
              <span>나만의 새로운 캐릭터</span>
            </label>
          </div>
        </fieldset>
        <div className="concept-form">
          <div className="form-fields">
            <label>
              컨셉 이름
              <input
                aria-label="컨셉 이름"
                required
                maxLength={100}
                value={input.name}
                disabled={busy}
                onChange={(event) => setInput({ ...input, name: event.target.value })}
                placeholder="예: 토끼찬구의 다정한 일상"
              />
            </label>
            <label>
              캐릭터 이름
              <input
                aria-label="캐릭터 이름"
                required
                maxLength={60}
                value={input.characterName}
                disabled={busy}
                onChange={(event) => setInput({ ...input, characterName: event.target.value })}
              />
            </label>
            <label>
              캐릭터 컨셉
              <textarea
                aria-label="캐릭터 컨셉"
                required
                minLength={5}
                maxLength={3000}
                rows={4}
                value={input.concept}
                disabled={busy}
                onChange={(event) => setInput({ ...input, concept: event.target.value })}
                placeholder="외모, 특징, 일상을 자유롭게 적어주세요."
              />
            </label>
            <div className="form-two">
              <label>
                성격과 말투
                <input
                  maxLength={500}
                  value={input.personality}
                  disabled={busy}
                  onChange={(event) => setInput({ ...input, personality: event.target.value })}
                />
              </label>
              <label>
                주요 사용 대상
                <input
                  maxLength={300}
                  value={input.audience}
                  disabled={busy}
                  onChange={(event) => setInput({ ...input, audience: event.target.value })}
                />
              </label>
            </div>
          </div>
          <div className="reference-column">
            <span className="field-label">
              참고 이미지 <span className="optional">선택</span>
            </span>
            <label className={`upload-zone ${input.referenceUrl ? 'has-image' : ''}`}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="참고 이미지"
                disabled={busy || uploading}
                onChange={(event) => {
                  void upload(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              {uploading ? (
                <Spinner label="이미지 업로드 중" />
              ) : input.referenceUrl ? (
                <img src={input.referenceUrl} alt="캐릭터 참고 이미지 미리보기" />
              ) : (
                <>
                  <ImagePlus size={28} />
                  <strong>캐릭터를 보여주세요</strong>
                  <span>PNG, JPG, WebP · 최대 10MB</span>
                </>
              )}
            </label>
            {input.referenceUrl && (
              <button
                type="button"
                className="text-button muted"
                disabled={busy || uploading}
                onClick={() => setInput({ ...input, referenceUrl: null })}
              >
                이미지 제거
              </button>
            )}
            <p className="field-hint">
              프리셋은 준비된 캐릭터 그림을 사용해요. 직접 입력한 외형과 참고 이미지를 새 그림에
              반영하려면 AI 연결이 필요해요.
            </p>
          </div>
        </div>
        {error && <ErrorNotice message={error} />}
        <div className="modal-footer">
          <button
            type="button"
            className="button secondary"
            disabled={busy || uploading}
            onClick={onClose}
          >
            취소
          </button>
          <button className="button primary" disabled={busy || uploading}>
            {busy ? (
              <Spinner label="저장 중" />
            ) : concept ? (
              '캐릭터 컨셉 저장'
            ) : (
              '캐릭터 컨셉 만들기'
            )}
            <ArrowRight size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

function NewSetForm({
  concept,
  onSave,
  onClose,
}: {
  concept: CharacterConcept;
  onSave: (input: {
    name: string;
    format: ProjectFormat;
    captionsEnabled: boolean;
    actionPrompt?: string;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(`${concept.characterName}의 일상 ${concept.projectCount + 1}`);
  const [format, setFormat] = useState<ProjectFormat>('static');
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [actionPrompt, setActionPrompt] = useState<string>(DEFAULT_ACTION);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Modal
      title="새 이모티콘 세트"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <p className="modal-intro">
        <strong>{concept.characterName}</strong>의 컨셉을 이어받아, 새로운 감정들을 모아볼까요?
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            await onSave({
              name,
              format,
              captionsEnabled,
              ...(format === 'animated' ? { actionPrompt } : {}),
            });
          } catch (error) {
            setError(errorMessage(error));
            setBusy(false);
          }
        }}
      >
        <label>
          세트 이름
          <input
            aria-label="세트 이름"
            required
            maxLength={100}
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <fieldset className="format-fieldset" disabled={busy}>
          <legend>어떤 이모티콘을 만들까요?</legend>
          <div className="format-options">
            {(['static', 'animated'] as const).map((value) => (
              <label key={value} className={`format-option ${format === value ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="set-format"
                  aria-label={`${formatLabel(value)} ${KAKAO_STICKER_COUNTS[value]}개`}
                  checked={format === value}
                  onChange={() => setFormat(value)}
                />
                <span className="format-option-icon">
                  {value === 'animated' ? <Film size={22} /> : <ImageIcon size={22} />}
                </span>
                <span>
                  <strong>{formatLabel(value)}</strong>
                  <small>
                    {value === 'animated'
                      ? '장면마다 다른 표정과 움직임'
                      : '일상에 어울리는 다양한 포즈'}
                  </small>
                </span>
                <b>
                  {KAKAO_STICKER_COUNTS[value]}
                  <small>개</small>
                </b>
              </label>
            ))}
          </div>
          <p className="format-count-note">카카오 기준 수량 · 정지 32개 / 움직이는 24개</p>
        </fieldset>
        <label className="caption-checkbox">
          <input
            type="checkbox"
            aria-label="상황에 맞는 대사 넣기"
            checked={captionsEnabled}
            disabled={busy}
            onChange={(event) => setCaptionsEnabled(event.target.checked)}
          />
          <span>
            <strong>상황에 맞는 대사 넣기</strong>
            <small>
              각 감정에 어울리는 짧은 말을 이미지에 넣어요. 검수할 때 하나씩 바꾸거나 뺄 수 있어요.
            </small>
          </span>
        </label>
        {format === 'animated' && (
          <div className="initial-action-setting">
            <ActionInput value={actionPrompt} onChange={setActionPrompt} disabled={busy} />
            <p className="field-hint">
              직접 쓴 동작은 AI 생성에 적용돼요. 캐릭터 프리셋은 상황별로 준비된 동작을 사용해요.
            </p>
          </div>
        )}
        {error && <ErrorNotice message={error} />}
        <div className="modal-footer">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            취소
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? <Spinner label="세트 만드는 중" /> : '세트 만들기'}
            <ArrowRight size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}

function SetCard({
  project: item,
  index = 0,
  onOpen,
}: {
  project: Project;
  index?: number;
  onOpen: () => void;
}) {
  return (
    <button className="project-card" onClick={onOpen} aria-label={`${item.name} 세트 열기`}>
      <div className={`project-card-cover cover-${index % 3}`}>
        <span className="project-card-badge">
          <Badge status={item.status} />
        </span>
        {item.coverUrl || item.referenceUrl ? (
          <img src={item.coverUrl ?? item.referenceUrl ?? ''} alt={item.characterName} />
        ) : (
          <div className="placeholder-art">
            <Sparkles size={35} />
            <span>새로운 감정이 자라는 곳</span>
          </div>
        )}
        <span className="card-open-icon">
          <ArrowRight size={18} />
        </span>
      </div>
      <div className="project-card-content">
        <div className="project-card-name">
          <h3>{item.name}</h3>
          <span>
            {item.containsPresetSamples ? '프리셋' : item.stickerCount ? 'AI' : '준비 중'}
          </span>
        </div>
        <p>{item.concept}</p>
        <div className="project-card-meta">
          <span>
            {item.format === 'animated' ? <Film size={14} /> : <Layers3 size={14} />}
            {item.isLegacy
              ? `기존 세트 ${item.stickerCount}개`
              : `${item.format === 'animated' ? '움직이는' : '정지'} ${item.stickerCount} / ${item.targetCount}개`}
          </span>
          <time dateTime={item.updatedAt}>{date(item.updatedAt)}</time>
        </div>
        {item.stickerCount > 0 && (
          <div className="card-review-progress">
            <span style={{ width: `${(item.approvedCount / item.stickerCount) * 100}%` }} />
          </div>
        )}
      </div>
    </button>
  );
}

function ConceptWorkspace({
  concept,
  onBack,
  onAdd,
  onEdit,
  onOpen,
}: {
  concept: ConceptDetail;
  onBack: () => void;
  onAdd: () => void;
  onEdit: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="concept-workspace">
      <div className="breadcrumb">
        <button onClick={onBack}>내 작업실</button>
        <ChevronRight size={14} />
        <span>{concept.name}</span>
      </div>
      <section className="concept-identity">
        <div className="concept-portrait">
          {concept.coverUrl || concept.referenceUrl || concept.builtinCharacter ? (
            <img
              src={
                concept.referenceUrl ??
                concept.coverUrl ??
                CHARACTER_PRESETS.find((preset) => preset.id === concept.builtinCharacter)?.image ??
                ''
              }
              alt={concept.characterName}
            />
          ) : (
            <Sparkles size={48} />
          )}
        </div>
        <div>
          <span className="eyebrow">CHARACTER CONCEPT</span>
          <h1>{concept.name}</h1>
          <p>{concept.concept}</p>
          <div className="concept-traits">
            <span>{concept.characterName}</span>
            {concept.personality && <span>{concept.personality}</span>}
          </div>
        </div>
        <button className="button secondary small-button" onClick={onEdit}>
          <Pencil size={15} />
          컨셉 수정
        </button>
      </section>
      <section className="projects-section">
        <div className="section-title">
          <div>
            <span className="eyebrow">SAME CHARACTER, NEW STORIES</span>
            <h2>
              이모티콘 세트 <span className="title-count">{concept.projects.length}</span>
            </h2>
            <p className="field-hint">
              하나의 캐릭터로 여러 세트를 만들어요. 세트별 검수와 버전은 따로 보관돼요.
            </p>
          </div>
          <button className="button primary" onClick={onAdd}>
            <Plus size={17} />새 세트 추가
          </button>
        </div>
        {concept.projects.length ? (
          <div className="project-grid">
            {concept.projects.map((item, index) => (
              <SetCard key={item.id} project={item} index={index} onOpen={() => onOpen(item.id)} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Layers3 size={36} />
            <h3>첫 번째 감정 모음을 만들어보세요</h3>
            <p>정지 32개 또는 움직이는 24개 세트를 추가할 수 있어요.</p>
            <button className="button secondary" onClick={onAdd}>
              <Plus size={17} />첫 세트 만들기
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function AuthForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => Promise<void> }) {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      await api(
        `/auth/${mode}`,
        json('POST', {
          ...(mode === 'register' ? { name: form.get('name') } : {}),
          email: form.get('email'),
          password: form.get('password'),
        }),
      );
      await onSuccess();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={mode === 'register' ? '나만의 작업실을 오래도록' : '다시 만나 반가워요'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="modal-intro">
        {mode === 'register'
          ? '계정을 만들면 지금 작업을 이어서, 다른 기기에서도 만날 수 있어요.'
          : '이메일과 비밀번호로 작업을 이어가세요.'}
      </p>
      <div className="segmented auth-tabs">
        <button
          onClick={() => {
            setMode('register');
            setError('');
          }}
          className={mode === 'register' ? 'active' : ''}
        >
          계정 만들기
        </button>
        <button
          onClick={() => {
            setMode('login');
            setError('');
          }}
          className={mode === 'login' ? 'active' : ''}
        >
          로그인
        </button>
      </div>
      <form onSubmit={submit} className="auth-form">
        {mode === 'register' && (
          <label>
            이름
            <input
              name="name"
              required
              maxLength={60}
              autoComplete="name"
              placeholder="작가님을 어떻게 부를까요?"
            />
          </label>
        )}
        <label>
          이메일
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="hello@example.com"
          />
        </label>
        <label>
          비밀번호
          <input
            name="password"
            type="password"
            required
            minLength={mode === 'register' ? 10 : 1}
            maxLength={128}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            placeholder={mode === 'register' ? '10자 이상 입력해 주세요' : '비밀번호'}
          />
        </label>
        {mode === 'login' && (
          <p className="field-hint">
            로그인하면 현재 게스트 작업도 해당 계정의 작업실에 함께 보관돼요.
          </p>
        )}
        {error && <ErrorNotice message={error} />}
        <button className="button primary full-width" disabled={busy}>
          {busy ? (
            <Spinner label="연결 중" />
          ) : mode === 'register' ? (
            '계정 만들고 작업 보관하기'
          ) : (
            '로그인'
          )}
        </button>
      </form>
    </Modal>
  );
}

function DirectionWorkspace({
  project,
  liveGeneration,
  onUpdated,
  onJob,
}: {
  project: ProjectDetail;
  liveGeneration: boolean;
  onUpdated: (project: ProjectDetail) => void;
  onJob: () => Promise<void>;
}) {
  const [directions, setDirections] = useState<Direction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [custom, setCustom] = useState(
    project.direction?.id.startsWith('custom') ? project.direction.description : '',
  );
  const [customOpen, setCustomOpen] = useState(false);
  const [provider, setProvider] = useState<Provider>('sample');
  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setDirections(await api<Direction[]>(`/projects/${project.id}/directions`, json('POST')));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [project.id]);
  const select = async (direction: Direction) => {
    setBusy(true);
    setError('');
    try {
      onUpdated(
        await api<ProjectDetail>(`/projects/${project.id}/direction`, json('PUT', { direction })),
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/projects/${project.id}/generate`, json('POST', { provider }));
      await onJob();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="direction-workspace">
      <div className="section-intro">
        <span className="eyebrow">STEP 02 · DIRECTION</span>
        <h2>어떤 감정을 담아볼까요?</h2>
        <p>컨셉을 바탕으로 정리한 방향을 고르거나, 직접 적어주세요.</p>
      </div>
      {loading ? (
        <div className="section-loading">
          <Spinner label="컨셉에 어울리는 방향을 정리하고 있어요" />
        </div>
      ) : (
        <div className="direction-grid">
          {directions.map((direction, index) => (
            <button
              disabled={busy}
              className={`direction-card ${project.direction?.id === direction.id ? 'selected' : ''}`}
              key={direction.id}
              onClick={() => {
                void select(direction);
              }}
              aria-pressed={project.direction?.id === direction.id}
            >
              <span className={`direction-icon direction-icon-${index}`}>
                <span>{['♡', '☀', '☁'][index % 3]}</span>
                {project.direction?.id === direction.id && <Check size={17} />}
              </span>
              <h3>{direction.title}</h3>
              <p>{direction.description}</p>
              <div className="tag-list">
                {direction.tags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <span className="choose-direction">
                {project.direction?.id === direction.id ? '선택한 방향' : '이 방향으로 만들기'}
                <ArrowRight size={16} />
              </span>
            </button>
          ))}
        </div>
      )}
      <div className={`custom-direction ${customOpen ? 'expanded' : ''}`}>
        <button
          className="custom-toggle"
          onClick={() => setCustomOpen(!customOpen)}
          aria-expanded={customOpen}
        >
          <Pencil size={17} />
          <span>
            떠오르는 다른 방향이 있나요? <strong>직접 입력하기</strong>
          </span>
          <ChevronDown size={18} />
        </button>
        {customOpen && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void select({
                id: 'custom-direction',
                title: '내가 정한 방향',
                description: custom,
                tags: ['직접 작성'],
                color: '#667452',
                prompts: [custom],
              });
            }}
          >
            <label>
              원하는 방향
              <textarea
                required
                minLength={5}
                maxLength={500}
                rows={3}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="예: 퇴근만 기다리는 늘보군의 직장 생활. 짧고 유쾌한 말투와 과장된 표정으로."
              />
            </label>
            <button className="button secondary" disabled={busy}>
              이 방향 선택
            </button>
          </form>
        )}
      </div>
      {project.direction && (
        <div className="selected-direction">
          <CheckCheck size={18} />
          <span>
            선택한 방향 <strong>{project.direction.title}</strong>
          </span>
        </div>
      )}
      {error && (
        <ErrorNotice
          message={error}
          retry={
            directions.length
              ? undefined
              : () => {
                  void load();
                }
          }
        />
      )}
      <div className="generation-settings">
        <div>
          <h3>
            {formatLabel(project.format)} {project.targetCount}개 세트
          </h3>
          <p>
            {provider === 'sample'
              ? project.format === 'animated'
                ? `캐릭터 프리셋 · 서로 다른 ${project.targetCount}개 상황과 동작`
                : `캐릭터 프리셋으로 ${project.targetCount}개의 서로 다른 상황과 포즈를 만들어요.`
              : '선택한 컨셉과 참고 이미지로 새로운 이모티콘을 생성해요.'}
          </p>
          {project.format === 'animated' && (
            <p>
              <Film size={13} className="inline-icon" />
              {provider === 'sample'
                ? '각 상황에 맞춰 표정과 부위가 움직이는 프리셋이에요.'
                : project.actionPrompt}
            </p>
          )}
        </div>
        <div className="generation-controls">
          <label className="compact-label">
            생성 방식
            <select
              aria-label="생성 방식"
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
            >
              <option value="sample">캐릭터 프리셋</option>
              <option value="openai" disabled={!liveGeneration}>
                AI 이미지 생성{!liveGeneration ? ' · 연결 필요' : ''}
              </option>
            </select>
          </label>
          <button
            className="button primary"
            disabled={!project.direction || busy || loading}
            onClick={() => {
              void generate();
            }}
          >
            {busy ? (
              <Spinner label="처리 중" />
            ) : (
              <>
                <Sparkles size={17} />
                이모티콘 생성
              </>
            )}
          </button>
        </div>
      </div>
      <p className="sample-disclaimer">
        <CircleHelp size={14} />
        {provider === 'sample'
          ? !project.builtinCharacter
            ? '직접 입력한 캐릭터의 그림을 생성하려면 AI 연결이 필요해요. 캐릭터 프리셋에서는 늘보군 예제를 사용해요.'
            : project.format === 'animated'
              ? '캐릭터 프리셋은 준비된 일러스트와 동작을 사용해요. 자유 입력한 외형·동작을 반영하려면 AI 생성을 선택해 주세요.'
              : '캐릭터 프리셋은 준비된 일러스트를 사용해요. 직접 입력한 외형이나 수정 의견을 새 그림에 반영하려면 AI 생성이 필요해요.'
          : 'AI 생성은 로그인한 계정에서 사용할 수 있고 제공자의 비용이 발생할 수 있어요. 생성 후 이미지와 사용 조건을 확인해 주세요.'}
      </p>
    </div>
  );
}

function StickerModal({
  sticker,
  project,
  liveGeneration,
  onClose,
  onUpdated,
  onJob,
}: {
  sticker: Sticker;
  project: ProjectDetail;
  liveGeneration: boolean;
  onClose: () => void;
  onUpdated: (project: ProjectDetail) => void;
  onJob: () => Promise<void>;
}) {
  const [feedback, setFeedback] = useState(sticker.feedback ?? '');
  const [title, setTitle] = useState(sticker.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState(false);
  const [previewBackground, setPreviewBackground] = useState<'light' | 'dark'>('light');
  const [captionEnabled, setCaptionEnabled] = useState(!!sticker.caption);
  const [caption, setCaption] = useState(sticker.caption ?? '');
  const [actionPrompt, setActionPrompt] = useState(
    sticker.animation?.actionPrompt || project.actionPrompt || DEFAULT_ACTION,
  );
  const [region, setRegion] = useState<AnimationRegion | null>(
    sticker.animation?.region ?? ARM_REGION,
  );
  useEffect(() => {
    setActionPrompt(sticker.animation?.actionPrompt || project.actionPrompt || DEFAULT_ACTION);
    setRegion(sticker.animation?.region ?? ARM_REGION);
    setCaptionEnabled(!!sticker.caption);
    setCaption(sticker.caption ?? '');
  }, [sticker.currentVersion]);
  const [provider, setProvider] = useState<Provider>(
    project.provider === 'openai' && liveGeneration ? 'openai' : 'sample',
  );
  const mutate = async (path: string, options: RequestInit, close = false) => {
    setBusy(true);
    setError('');
    try {
      const result = await api<ProjectDetail>(path, options);
      onUpdated(result);
      if (close) onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const revise = async () => {
    setBusy(true);
    setError('');
    try {
      await api(
        `/projects/${project.id}/stickers/${sticker.id}/revise`,
        json('POST', { feedback, provider }),
      );
      await onJob();
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const generateAction = async () => {
    setBusy(true);
    setError('');
    try {
      await api(
        `/projects/${project.id}/stickers/${sticker.id}/animate`,
        json('POST', {
          provider,
          actionPrompt: provider === 'sample' ? DEFAULT_ACTION : actionPrompt,
          region: provider === 'sample' ? null : region,
        }),
      );
      await onJob();
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const applyCaption = async () => {
    setBusy(true);
    setError('');
    try {
      await api(
        `/projects/${project.id}/stickers/${sticker.id}/caption`,
        json('POST', {
          enabled: captionEnabled,
          ...(captionEnabled ? { text: caption.trim() } : {}),
        }),
      );
      await onJob();
      onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="이모티콘 검수"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className={`sticker-editor ${sticker.animation ? 'has-frame-player' : ''}`}>
        <div className={`sticker-preview preview-${previewBackground}`}>
          <div className="preview-background-controls" role="group" aria-label="검수 배경">
            <span>검수 배경</span>
            <button
              type="button"
              aria-label="밝은 배경"
              aria-pressed={previewBackground === 'light'}
              onClick={() => setPreviewBackground('light')}
            >
              <span className="background-swatch light" />
              밝게
            </button>
            <button
              type="button"
              aria-label="어두운 배경"
              aria-pressed={previewBackground === 'dark'}
              onClick={() => setPreviewBackground('dark')}
            >
              <span className="background-swatch dark" />
              어둡게
            </button>
          </div>
          {sticker.animation ? (
            <FramePlayer key={sticker.currentVersion} sticker={sticker} />
          ) : (
            <div className="transparency-grid">
              <LegacyAnimatedPreview key={sticker.currentVersion} sticker={sticker} />
            </div>
          )}
          {sticker.frameCount > 1 && (
            <p className="animation-caption">
              <Film size={14} />
              {animationLabel(sticker)} · {(sticker.durationMs / 1000).toFixed(1)}초 ·{' '}
              {sticker.frameCount}프레임
            </p>
          )}
          {!!sticker.animation?.warnings?.length && (
            <div className="frame-quality-notes" role="note" aria-label="프레임 검수 참고">
              <strong>한 번 더 살펴봐 주세요</strong>
              <ul>
                {[...new Set(sticker.animation.warnings)].map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <Badge status={sticker.status} />
            <span className="version-label">v{sticker.currentVersion}</span>
          </div>
        </div>
        <div className="sticker-editor-fields">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(
                `/projects/${project.id}/stickers/${sticker.id}`,
                json('PATCH', { title }),
              );
            }}
          >
            <label>
              이모티콘 이름
              <input
                value={title}
                required
                maxLength={80}
                disabled={project.status === 'completed' || busy}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            {title !== sticker.title && (
              <button className="text-button" disabled={busy}>
                이름 저장
              </button>
            )}
          </form>
          <div className="emotion-label">
            <MessageCircle size={16} />
            {sticker.emotion}
          </div>
          <p className="single-sticker-note">
            <ShieldCheck size={15} />이 이모티콘만 수정해요. 나머지{' '}
            {Math.max(0, project.stickers.length - 1)}개는 바뀌지 않아요.
          </p>
          {project.status !== 'completed' && (
            <section className="caption-editor" aria-label="대사 편집">
              <label className="caption-checkbox">
                <input
                  type="checkbox"
                  aria-label="대사 넣기"
                  checked={captionEnabled}
                  disabled={busy}
                  onChange={(event) => setCaptionEnabled(event.target.checked)}
                />
                <span>
                  <strong>대사 넣기</strong>
                  <small>그림과 함께 저장되고 다운로드에도 포함돼요.</small>
                </span>
              </label>
              {captionEnabled && (
                <label>
                  대사 내용
                  <textarea
                    aria-label="대사 내용"
                    value={caption}
                    rows={2}
                    maxLength={24}
                    disabled={busy}
                    placeholder="예: 오늘도 반가워!"
                    onChange={(event) => setCaption(event.target.value)}
                  />
                  <span className="caption-length">{caption.length}/24 · 최대 두 줄</span>
                </label>
              )}
              <button
                className="button secondary full-width"
                disabled={
                  busy ||
                  (captionEnabled && !caption.trim()) ||
                  (captionEnabled === !!sticker.caption &&
                    (!captionEnabled || caption === sticker.caption))
                }
                onClick={() => {
                  void applyCaption();
                }}
              >
                <MessageCircle size={15} />
                대사 적용
              </button>
              <p className="field-hint">
                이미지 생성 비용 없이 새 버전으로 저장해요. 대사를 빼면 깨끗한 원본 그림을 다시
                사용해요.
              </p>
            </section>
          )}
          {project.format === 'animated' && project.status !== 'completed' && (
            <section className="action-editor" aria-label="부위 동작 만들기">
              <div className="action-editor-heading">
                <strong>어떻게 움직일까요?</strong>
                <span>동작 프레임 생성</span>
              </div>
              <label className="compact-label">
                동작 생성 방식
                <select
                  aria-label="동작 생성 방식"
                  value={provider}
                  disabled={busy}
                  onChange={(event) => setProvider(event.target.value as Provider)}
                >
                  <option value="sample">캐릭터 프리셋</option>
                  <option value="openai" disabled={!liveGeneration}>
                    AI 부위 동작{!liveGeneration ? ' · 연결 필요' : ''}
                  </option>
                </select>
              </label>
              <ActionInput
                value={
                  provider === 'sample'
                    ? sticker.animation?.actionPrompt ||
                      '현재 감정에 어울리는 캐릭터 프리셋 동작을 적용해요.'
                    : actionPrompt
                }
                onChange={setActionPrompt}
                disabled={busy || provider === 'sample'}
                onSuggestion={(index) =>
                  setRegion(
                    index === 1
                      ? { x: 0.24, y: 0.2, width: 0.52, height: 0.3 }
                      : index === 2
                        ? { x: 0.18, y: 0.1, width: 0.65, height: 0.5 }
                        : ARM_REGION,
                  )
                }
              />
              <RegionEditor
                sticker={sticker}
                value={region}
                onChange={setRegion}
                disabled={busy || provider === 'sample'}
              />
              <p className="field-hint">
                {provider === 'sample'
                  ? '이 상황에 맞는 캐릭터 프리셋 동작을 적용해요. 직접 입력한 동작이나 영역은 AI 생성에서 반영돼요.'
                  : '선택한 부위가 움직이는 여러 자세를 AI로 생성해요. 새 그림이 원본과 달라질 수 있으며 로그인과 이미지 생성 비용이 필요해요.'}
              </p>
              <button
                className="button secondary full-width"
                disabled={busy || (provider === 'openai' && actionPrompt.trim().length < 5)}
                onClick={() => {
                  void generateAction();
                }}
              >
                <Film size={16} />
                {provider === 'sample' ? '프리셋 동작 적용' : '동작 만들기'}
              </button>
            </section>
          )}
          {project.status !== 'completed' ? (
            <>
              <label>
                수정 의견
                <textarea
                  rows={4}
                  maxLength={2000}
                  value={feedback}
                  disabled={busy}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder={
                    project.format === 'animated'
                      ? '예: 4번 프레임의 손가락 모양이 어색해요. 마지막 자세가 첫 자세와 자연스럽게 이어졌으면 좋겠어요.'
                      : '예: 눈을 조금 더 크게, 웃는 표정으로 바꿔주세요.'
                  }
                />
              </label>
              {project.format !== 'animated' && (
                <>
                  <div className="revision-provider">
                    <label className="compact-label">
                      수정 방식
                      <select
                        aria-label="수정 방식"
                        value={provider}
                        disabled={busy}
                        onChange={(e) => setProvider(e.target.value as Provider)}
                      >
                        <option value="sample">캐릭터 프리셋 수정</option>
                        <option value="openai" disabled={!liveGeneration}>
                          AI 이미지 수정{!liveGeneration ? ' · 연결 필요' : ''}
                        </option>
                      </select>
                    </label>
                  </div>
                  <p className="field-hint">
                    {provider === 'sample'
                      ? '현재 감정에 맞는 다른 포즈로 바꿔요. 수정 의견은 기록하며, 의견의 자유로운 해석은 AI 수정에서 가능해요.'
                      : '현재 이미지와 수정 의견으로 새 버전을 만들어요. 로그인한 계정이 필요하고 AI 제공자의 비용이 발생할 수 있어요.'}
                  </p>
                </>
              )}
              {project.format === 'animated' && (
                <p className="field-hint">
                  {provider === 'sample'
                    ? '수정 의견을 기록하고 현재 감정에 맞는 새 프리셋 포즈를 만들어요. 직접 적은 의견을 해석해 반영하려면 AI 수정을 선택해 주세요.'
                    : '현재 버전의 동작과 영역을 유지하며 의견을 반영해요. 현재 움직일 영역 밖의 부위를 바꾸려면 위에서 영역과 동작을 다시 정해 주세요.'}
                </p>
              )}
              <button
                className="text-button"
                disabled={busy || feedback.trim().length < 3}
                onClick={() => {
                  void mutate(
                    `/projects/${project.id}/stickers/${sticker.id}`,
                    json('PATCH', { status: 'changes_requested', feedback }),
                    true,
                  );
                }}
              >
                <MessageCircle size={15} />
                수정 의견 저장
              </button>
              <div className="review-actions">
                <button
                  className="button secondary"
                  disabled={busy || feedback.trim().length < 3}
                  onClick={() => {
                    void revise();
                  }}
                >
                  <WandSparkles size={16} />
                  {provider === 'sample' ? '다른 포즈로 수정' : '의견 반영해 수정'}
                </button>
                <button
                  className="button primary"
                  disabled={busy || sticker.status === 'approved'}
                  onClick={() => {
                    void mutate(
                      `/projects/${project.id}/stickers/${sticker.id}`,
                      json('PATCH', { status: 'approved' }),
                      true,
                    );
                  }}
                >
                  <Check size={17} />
                  {sticker.status === 'approved' ? '승인 완료' : '승인'}
                </button>
              </div>
              {sticker.status === 'approved' && (
                <button
                  disabled={busy}
                  className="text-button muted"
                  onClick={() => {
                    void mutate(
                      `/projects/${project.id}/stickers/${sticker.id}`,
                      json('PATCH', { status: 'pending' }),
                    );
                  }}
                >
                  승인 취소
                </button>
              )}
            </>
          ) : (
            <p className="completed-note">
              <ShieldCheck size={18} />
              완료된 프로젝트예요. 다시 검수하기를 누르면 수정할 수 있어요.
            </p>
          )}
          <button
            className="history-toggle"
            onClick={() => setHistory(!history)}
            aria-expanded={history}
          >
            <Clock3 size={16} />
            버전 기록 <span>{sticker.versions.length}</span>
            <ChevronDown size={17} />
          </button>
          {history && (
            <div className="versions">
              {[...sticker.versions]
                .sort((a, b) => b.version - a.version)
                .map((version) => (
                  <div className="version-item" key={version.id}>
                    <img src={version.posterUrl} alt={`버전 ${version.version}`} />
                    <div>
                      <strong>
                        버전 {version.version}
                        {version.version === sticker.currentVersion && <small>현재</small>}
                      </strong>
                      <p>{version.feedback ?? '첫 번째 이미지'}</p>
                      <span>
                        {date(version.createdAt)} ·{' '}
                        {version.provider === 'sample'
                          ? version.poseId
                            ? '캐릭터 프리셋'
                            : '이전 예제'
                          : 'AI 생성'}
                        {version.animation
                          ? ' · 동작 프레임'
                          : version.motionPreset
                            ? ' · 이전 방식 · 전체 움직임'
                            : ''}
                      </span>
                    </div>
                    {version.version !== sticker.currentVersion &&
                      project.status !== 'completed' && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => {
                            void mutate(
                              `/projects/${project.id}/stickers/${sticker.id}/restore`,
                              json('POST', { version: version.version }),
                            );
                          }}
                        >
                          복원
                        </button>
                      )}
                  </div>
                ))}
            </div>
          )}
          {busy && <Spinner label="저장 중" />}
          {error && <ErrorNotice message={error} />}
        </div>
      </div>
    </Modal>
  );
}

function ExportModal({ project, onClose }: { project: ProjectDetail; onClose: () => void }) {
  const [size, setSize] = useState(360);
  const [format, setFormat] = useState<'webp' | 'gif'>('webp');
  const animated = project.format === 'animated';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(
        `/api/projects/${project.id}/export?size=${animated ? 360 : size}${animated ? `&format=${format}` : ''}`,
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? '다운로드를 준비하지 못했어요.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${project.name}-${animated ? format : 'png'}-${animated ? 360 : size}px.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setDownloaded(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="세상에 선보일 준비가 됐어요"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="export-preview">
        {project.stickers.slice(0, 3).map((sticker) => (
          <img key={sticker.id} src={sticker.posterUrl} alt={sticker.title} />
        ))}
      </div>
      <p className="modal-intro">
        승인한 {formatLabel(project.format)} {project.stickers.length}개와 작업 정보를 ZIP 파일로
        내려받아요.
      </p>
      {animated ? (
        <div className="animated-export-options">
          <label>
            애니메이션 형식
            <select
              aria-label="애니메이션 형식"
              value={format}
              onChange={(event) => setFormat(event.target.value as 'webp' | 'gif')}
            >
              <option value="webp">움직이는 WebP</option>
              <option value="gif">움직이는 GIF</option>
            </select>
          </label>
          <p className="field-hint">
            360 × 360px의 반복 애니메이션과 각 이미지의 정지 PNG를 함께 담아요.
          </p>
        </div>
      ) : (
        <label>
          이미지 크기
          <select
            aria-label="이미지 크기"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          >
            <option value={360}>360 × 360 px</option>
            <option value={720}>720 × 720 px</option>
            <option value={1024}>1024 × 1024 px</option>
          </select>
        </label>
      )}
      <div className="export-details">
        <span>파일 형식</span>
        <strong>{animated ? `${format.toUpperCase()} + PNG` : 'PNG'} · ZIP</strong>
        <span>포함 내용</span>
        <strong>
          {animated
            ? `애니메이션 ${project.stickers.length}개, 정지 이미지 ${project.stickers.length}개, 작업 정보`
            : `이모티콘 ${project.stickers.length}개, 작업 정보`}
        </strong>
        <span>제작 수량</span>
        <strong>
          {project.isLegacy
            ? `기존 세트 ${project.targetCount}개`
            : `카카오 기준 ${project.targetCount}개`}
        </strong>
      </div>
      <p className="field-hint">
        판매·등록 전 플랫폼의 최신 규격과 이미지 권리를 확인해 주세요. 카카오는 생성형 AI 활용
        제안을 제한하고 있어요. 수량이 맞아도 제안 가능 여부는 별도 정책에 따라 달라요.{' '}
        <a href="https://emoticonstudio.kakao.com/guideline" target="_blank" rel="noreferrer">
          카카오 공식 가이드 확인
        </a>
        {containsSamples(project) && ` ${sampleDescription(project)}`}
      </p>
      {animated && (
        <div className="export-platform-note">
          <CircleHelp size={17} />
          <p>
            이 파일은 일반 애니메이션 출력물이에요. 카카오 제안에는 공식 전용 도구로 다시 인코딩하고
            아이콘·용량 등 별도 요건을 확인해야 해요.{' '}
            <a
              href="https://kakaoemoticonstudio.notion.site/animated-emoticon"
              target="_blank"
              rel="noreferrer"
            >
              움직이는 이모티콘 가이드
            </a>
          </p>
        </div>
      )}
      {error && <ErrorNotice message={error} />}
      {downloaded && (
        <p className="success-note" role="status">
          <Check size={16} />
          파일 다운로드를 시작했어요.
        </p>
      )}
      <div className="modal-footer">
        <button className="button secondary" onClick={onClose} disabled={busy}>
          닫기
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => {
            void download();
          }}
        >
          {busy ? (
            <Spinner label="파일 준비 중" />
          ) : (
            <>
              <ArrowDownToLine size={17} />
              ZIP 다운로드
            </>
          )}
        </button>
      </div>
    </Modal>
  );
}

function ProjectView({
  project,
  liveGeneration,
  onBack,
  onUpdated,
  onRefresh,
  onEdit,
  onDelete,
  onExport,
  onSticker,
}: {
  project: ProjectDetail;
  liveGeneration: boolean;
  onBack: () => void;
  onUpdated: (project: ProjectDetail) => void;
  onRefresh: () => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  onExport: () => void;
  onSticker: (sticker: Sticker) => void;
}) {
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState(false);
  const [menu, setMenu] = useState(false);
  const jobActive = isBusyJob(project);
  const failedBatch =
    project.job?.status === 'failed' && (project.job.requestedCount ?? project.job.total) > 1;
  const incompleteBatch = project.stickers.length < project.targetCount;
  const done = project.status === 'completed';
  const hasStickers = project.stickers.length > 0;
  const approved = project.stickers.filter((sticker) => sticker.status === 'approved').length;
  const currentStep = done ? 4 : hasStickers ? 3 : jobActive ? 2 : 1;
  const retryGeneration = async () => {
    setBusy(true);
    setError('');
    try {
      await api(
        `/projects/${project.id}/generate`,
        json('POST', {
          provider: project.provider,
        }),
      );
      await onRefresh();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const action = async (path: string) => {
    setBusy(true);
    setError('');
    try {
      onUpdated(await api<ProjectDetail>(`/projects/${project.id}/${path}`, json('POST')));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="project-view">
      <div className="breadcrumb">
        <button onClick={onBack}>{project.characterName}의 세트</button>
        <ChevronRight size={14} />
        <span>{project.name}</span>
      </div>
      <div className="project-heading">
        <div>
          <div className="project-title-line">
            <h1>{project.name}</h1>
            <Badge status={project.status} />
          </div>
          <p>{project.characterName}의 감정들이 하나씩 모이는 곳</p>
        </div>
        <div className="project-heading-actions">
          <span className="saved-label">
            <Cloud size={16} />
            저장됨
          </span>
          {done && (
            <button className="button primary" onClick={onExport}>
              <ArrowDownToLine size={17} />
              다운로드
            </button>
          )}
          <div className="project-more">
            <button
              className="icon-button bordered"
              aria-label="프로젝트 메뉴"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <Ellipsis size={20} />
            </button>
            {menu && (
              <>
                <button
                  className="menu-dismiss"
                  aria-label="프로젝트 메뉴 닫기"
                  onClick={() => setMenu(false)}
                />
                <div className="dropdown-menu">
                  {!hasStickers && !jobActive && (
                    <button
                      onClick={() => {
                        setMenu(false);
                        onEdit();
                      }}
                    >
                      <Pencil size={15} />
                      컨셉 수정
                    </button>
                  )}
                  {done && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        setMenu(false);
                        void action('reopen');
                      }}
                    >
                      <Pencil size={15} />
                      다시 검수하기
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setMenu(false);
                      setActivity(!activity);
                    }}
                  >
                    <Clock3 size={15} />
                    작업 기록
                  </button>
                  <button
                    className="danger-text"
                    onClick={() => {
                      setMenu(false);
                      onDelete();
                    }}
                    disabled={jobActive}
                  >
                    <Trash2 size={15} />
                    프로젝트 삭제
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="steps" aria-label="제작 단계">
        {['컨셉 잡기', '방향 선택', '이모티콘 생성', '검수 및 완료'].map((step, index) => (
          <div
            key={step}
            className={index < currentStep ? 'passed' : index === currentStep ? 'current' : ''}
          >
            <span>{index < currentStep ? <Check size={13} /> : `0${index + 1}`}</span>
            {step}
            {index < 3 && <ChevronRight size={15} />}
          </div>
        ))}
      </div>
      <section className="set-progress" aria-label="프로젝트 목표 진행률">
        <div className="set-progress-kind">
          <span>
            {project.format === 'animated' ? <Film size={19} /> : <ImageIcon size={19} />}
          </span>
          <div>
            <strong>{formatLabel(project.format)}</strong>
            <small>
              {project.isLegacy
                ? '기존 세트 · 이전 작업 유지'
                : `카카오 기준 수량 ${project.targetCount}개`}
            </small>
          </div>
        </div>
        <div className="set-progress-counts">
          <span>
            생성{' '}
            <strong>
              {project.stickers.length}
              <small> / {project.targetCount}</small>
            </strong>
          </span>
          <span>
            승인{' '}
            <strong>
              {approved}
              <small> / {project.targetCount}</small>
            </strong>
          </span>
        </div>
        <div
          className="set-progress-bar"
          role="progressbar"
          aria-label="이모티콘 생성 진행률"
          aria-valuemin={0}
          aria-valuemax={project.targetCount}
          aria-valuenow={project.stickers.length}
        >
          <span
            style={{
              width: `${Math.min(100, (project.stickers.length / project.targetCount) * 100)}%`,
            }}
          />
          <i style={{ width: `${Math.min(100, (approved / project.targetCount) * 100)}%` }} />
        </div>
      </section>
      <div className="concept-summary">
        <div className="concept-avatar">
          <img
            src={
              project.referenceUrl ??
              CHARACTER_PRESETS.find((preset) => preset.id === project.builtinCharacter)?.image ??
              '/samples/hello.png'
            }
            alt={`${project.characterName} 참고 이미지`}
          />
        </div>
        <div>
          <span className="eyebrow">CHARACTER NOTE</span>
          <h3>{project.characterName}</h3>
          <p>{project.concept}</p>
        </div>
        {!hasStickers && !jobActive && (
          <button className="icon-button" onClick={onEdit} aria-label="컨셉 수정">
            <Pencil size={17} />
          </button>
        )}
        {project.direction && (
          <span className="direction-summary">
            <Sparkles size={14} />
            {project.direction.title}
          </span>
        )}
      </div>
      {error && <ErrorNotice message={error} />}
      {activity && (
        <section className="activity-panel">
          <div className="section-title">
            <h3>작업 기록</h3>
            <button
              className="icon-button"
              aria-label="작업 기록 닫기"
              onClick={() => setActivity(false)}
            >
              <X size={17} />
            </button>
          </div>
          {project.activities.length === 0 ? (
            <p>아직 작업 기록이 없어요.</p>
          ) : (
            project.activities.map((item) => (
              <div className="activity-item" key={item.id}>
                <span className="activity-dot" />
                <p>{item.message}</p>
                <time dateTime={item.createdAt}>{date(item.createdAt)}</time>
              </div>
            ))
          )}
        </section>
      )}
      {jobActive && (
        <div className="generation-progress" role="status">
          <div className="generation-illustration">
            <img
              src={
                CHARACTER_PRESETS.find((preset) => preset.id === project.builtinCharacter)?.image ??
                '/samples/hello.png'
              }
              alt=""
            />
            <Sparkles size={20} />
          </div>
          <div>
            <span className="eyebrow">A LITTLE MAGIC IN PROGRESS</span>
            <h2>{hasStickers ? '새로운 표정을 그리고 있어요' : '상상에 표정을 더하고 있어요'}</h2>
            <p>
              {project.provider === 'sample'
                ? '선택한 캐릭터의 그림과 대사를 준비하고 있어요.'
                : '캐릭터의 특징을 담아 이미지가 차례로 만들어져요. 잠시만 기다려 주세요.'}
            </p>
            <div className="progress-track">
              <span
                style={{
                  width: `${Math.max(4, ((project.job?.completed ?? 0) / (project.job?.total || 1)) * 100)}%`,
                }}
              />
            </div>
            <span className="progress-caption">
              {project.job?.completed ?? 0} / {project.job?.total ?? project.targetCount}개 준비
              완료 · 이 페이지를 나가도 작업은 계속돼요
            </span>
          </div>
        </div>
      )}
      {project.job?.status === 'failed' && (
        <div className="failed-generation">
          <ErrorNotice
            message={`생성을 마치지 못했어요. ${project.job.error ?? '다시 시도해 주세요.'}${!failedBatch ? ' 수정할 이모티콘을 다시 선택해 주세요.' : ''}`}
          />
          {incompleteBatch && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                void retryGeneration();
              }}
            >
              {busy ? <Spinner label="재시도 준비 중" /> : '남은 이모티콘 생성 재시도'}
            </button>
          )}
        </div>
      )}
      {!hasStickers && !jobActive && (
        <DirectionWorkspace
          project={project}
          liveGeneration={liveGeneration}
          onUpdated={onUpdated}
          onJob={onRefresh}
        />
      )}
      {hasStickers && (
        <section className="review-section">
          <div className="section-title">
            <div>
              <span className="eyebrow">
                {done ? 'YOUR FINISHED COLLECTION' : 'STEP 04 · REVIEW'}
              </span>
              <h2>
                {done ? '작은 감정들이 완성됐어요' : '하나씩 살펴보고, 마음을 담아요'}{' '}
                <span className="title-count">{project.stickers.length}</span>
              </h2>
            </div>
            {!done && (
              <button
                className="button secondary small-button"
                disabled={
                  busy || jobActive || incompleteBatch || approved === project.stickers.length
                }
                onClick={() => {
                  void action('approve-all');
                }}
              >
                <CheckCheck size={16} />
                전체 승인
              </button>
            )}
          </div>
          <div className="review-toolbar">
            <div className="filter-tabs">
              {[
                ['all', '전체', project.stickers.length],
                [
                  'pending',
                  '검수 대기',
                  project.stickers.filter((s) => s.status === 'pending').length,
                ],
                ['approved', '승인 완료', approved],
                [
                  'changes_requested',
                  '수정 요청',
                  project.stickers.filter((s) => s.status === 'changes_requested').length,
                ],
              ].map(([key, label, amount]) => (
                <button
                  key={key}
                  className={filter === key ? 'active' : ''}
                  onClick={() => setFilter(String(key))}
                >
                  {label}
                  <span>{amount}</span>
                </button>
              ))}
            </div>
            <span className="review-hint">클릭해서 크게 보고 수정해요</span>
          </div>
          <div className="sticker-grid">
            {project.stickers
              .filter((sticker) => filter === 'all' || sticker.status === filter)
              .map((sticker, index) => (
                <StickerReviewCard
                  key={sticker.id}
                  sticker={sticker}
                  index={index}
                  busy={jobActive}
                  onSelect={() => onSticker(sticker)}
                />
              ))}
          </div>
          {project.stickers.filter((sticker) => filter === 'all' || sticker.status === filter)
            .length === 0 && (
            <div className="empty-filter">
              <CheckCheck size={28} />
              <p>이 상태의 이모티콘이 없어요.</p>
              <button className="text-button" onClick={() => setFilter('all')}>
                전체 보기
              </button>
            </div>
          )}
          {containsSamples(project) && (
            <p className="sample-disclaimer">
              <CircleHelp size={14} />
              {sampleDescription(project)}
            </p>
          )}
          <div className={`review-bottom ${done ? 'finished' : ''}`}>
            <div className="review-bottom-icon">
              {done ? <FolderHeart size={23} /> : <CopyCheck size={23} />}
            </div>
            <div>
              <strong>
                {done
                  ? '이제 당신의 일상에 건네보세요.'
                  : `${project.targetCount}개 중 ${approved}개를 승인했어요.`}
              </strong>
              <p>
                {done
                  ? '완성한 이모티콘은 언제든 이 작업실에서 다시 볼 수 있어요.'
                  : incompleteBatch
                    ? '생성이 끝나지 않았어요. 남은 이모티콘을 생성한 뒤 검수를 완료해 주세요.'
                    : approved === project.stickers.length
                      ? '모두 준비됐어요. 검수를 마치고 완성본을 내려받아보세요.'
                      : '모든 이모티콘을 승인하면 완성본을 내려받을 수 있어요.'}
              </p>
            </div>
            {done ? (
              <button className="button primary" onClick={onExport}>
                <ArrowDownToLine size={17} />
                다운로드
              </button>
            ) : (
              <button
                className="button primary"
                disabled={
                  busy || jobActive || incompleteBatch || approved !== project.stickers.length
                }
                onClick={() => {
                  void action('complete');
                }}
              >
                <Check size={17} />
                검수 완료
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

type Section = 'workspace' | 'library' | 'completed';
type Dialog =
  | 'new'
  | 'newSet'
  | 'editConcept'
  | 'edit'
  | 'auth'
  | 'settings'
  | 'help'
  | 'delete'
  | 'export'
  | null;

export default function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [initialError, setInitialError] = useState('');
  const [section, setSection] = useState<Section>('workspace');
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [concept, setConcept] = useState<ConceptDetail | null>(null);
  const [conceptLoading, setConceptLoading] = useState(false);
  const conceptRef = useRef<string | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [pageError, setPageError] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [stickerId, setStickerId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('recent');
  const [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const selectedRef = useRef<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  };
  const bootstrap = async () => {
    setInitialError('');
    const result = await api<Bootstrap>('/bootstrap');
    setBoot(result);
  };
  useEffect(() => {
    void bootstrap().catch((error) => setInitialError(errorMessage(error)));
    return () => clearTimeout(toastTimer.current);
  }, []);
  const refreshProjects = async () => {
    const [projects, concepts] = await Promise.all([
      api<Project[]>('/projects'),
      api<CharacterConcept[]>('/concepts'),
    ]);
    setBoot((previous) => (previous ? { ...previous, projects, concepts } : previous));
  };
  const updated = (detail: ProjectDetail) => {
    if (selectedRef.current === detail.id) setProject(detail);
    setBoot((previous) =>
      previous
        ? {
            ...previous,
            projects: previous.projects.some((item) => item.id === detail.id)
              ? previous.projects.map((item) => (item.id === detail.id ? detail : item))
              : [detail, ...previous.projects],
          }
        : previous,
    );
  };
  const openConcept = async (id: string) => {
    conceptRef.current = id;
    selectedRef.current = null;
    setProject(null);
    setProjectLoading(false);
    setConcept(null);
    setConceptLoading(true);
    setPageError('');
    setSidebar(false);
    try {
      const detail = await api<ConceptDetail>(`/concepts/${id}`);
      if (conceptRef.current === id) setConcept(detail);
    } catch (error) {
      if (conceptRef.current === id) setPageError(errorMessage(error));
    } finally {
      if (conceptRef.current === id) setConceptLoading(false);
    }
  };
  const openProject = async (id: string) => {
    selectedRef.current = id;
    setProject(null);
    setProjectLoading(true);
    setPageError('');
    setSidebar(false);
    setFilter('all');
    try {
      const detail = await api<ProjectDetail>(`/projects/${id}`);
      if (selectedRef.current === id) {
        setProject(detail);
        conceptRef.current = detail.conceptId;
      }
    } catch (error) {
      if (selectedRef.current === id) setPageError(errorMessage(error));
    } finally {
      if (selectedRef.current === id) setProjectLoading(false);
    }
  };
  const refreshDetail = async () => {
    const id = selectedRef.current;
    if (!id) return;
    const detail = await api<ProjectDetail>(`/projects/${id}`);
    updated(detail);
  };
  useEffect(() => {
    if (!project || !isBusyJob(project)) return;
    let cancelled = false;
    let fetching = false;
    const timer = setInterval(async () => {
      if (fetching) return;
      fetching = true;
      try {
        const detail = await api<ProjectDetail>(`/projects/${project.id}`);
        if (!cancelled) {
          updated(detail);
          setPageError('');
          if (!isBusyJob(detail))
            notify(
              detail.job?.status === 'failed'
                ? '생성 결과를 확인해 주세요.'
                : '새로운 이미지가 준비됐어요. 검수를 시작해 보세요.',
            );
        }
      } catch (error) {
        if (!cancelled) setPageError(errorMessage(error));
      } finally {
        fetching = false;
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [project?.id, project?.job?.status]);
  const navigate = (next: Section) => {
    setSection(next);
    setConcept(null);
    conceptRef.current = null;
    setConceptLoading(false);
    setProject(null);
    selectedRef.current = null;
    setProjectLoading(false);
    setPageError('');
    setQuery('');
    setFilter('all');
    setSidebar(false);
    void refreshProjects().catch((error) => setPageError(errorMessage(error)));
  };
  const create = async (input: CreateConceptInput) => {
    const detail = await api<ConceptDetail>('/concepts', json('POST', input));
    conceptRef.current = detail.id;
    setConcept({ ...detail, projects: detail.projects ?? [] });
    setProject(null);
    selectedRef.current = null;
    setBoot((previous) =>
      previous ? { ...previous, concepts: [detail, ...previous.concepts] } : previous,
    );
    setDialog(null);
    setPageError('');
    notify('캐릭터 컨셉을 작업실에 저장했어요.');
    void refreshProjects().catch((error) => setPageError(errorMessage(error)));
  };
  const editConcept = async (input: CreateConceptInput) => {
    if (!concept) return;
    const detail = await api<ConceptDetail>(`/concepts/${concept.id}`, json('PATCH', input));
    setConcept(detail);
    setBoot((previous) =>
      previous
        ? {
            ...previous,
            concepts: previous.concepts.map((item) => (item.id === detail.id ? detail : item)),
          }
        : previous,
    );
    setDialog(null);
    notify('캐릭터 컨셉을 저장했어요.');
    void refreshProjects().catch((error) => setPageError(errorMessage(error)));
  };
  const createSet = async (input: {
    name: string;
    format: ProjectFormat;
    captionsEnabled: boolean;
    actionPrompt?: string;
  }) => {
    if (!concept) return;
    const detail = await api<ProjectDetail>(
      `/concepts/${concept.id}/projects`,
      json('POST', input),
    );
    selectedRef.current = detail.id;
    updated(detail);
    setConcept((previous) =>
      previous
        ? {
            ...previous,
            projectCount: previous.projectCount + 1,
            projects: [detail, ...previous.projects],
          }
        : previous,
    );
    setDialog(null);
    setPageError('');
    notify('캐릭터에 새 세트를 추가했어요.');
    void refreshProjects().catch((error) => setPageError(errorMessage(error)));
  };
  const edit = async (input: CreateProjectInput) => {
    if (!project) return;
    updated(await api<ProjectDetail>(`/projects/${project.id}`, json('PATCH', input)));
    setDialog(null);
    notify('컨셉을 저장했어요.');
  };
  const remove = async () => {
    if (!project) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api(`/projects/${project.id}`, json('DELETE'));
      setBoot((previous) =>
        previous
          ? { ...previous, projects: previous.projects.filter((item) => item.id !== project.id) }
          : previous,
      );
      setDialog(null);
      setProject(null);
      selectedRef.current = null;
      notify('세트를 삭제했어요.');
      void refreshProjects().catch((error) => setPageError(errorMessage(error)));
      if (conceptRef.current) void openConcept(conceptRef.current);
    } catch (error) {
      setDeleteError(errorMessage(error));
    } finally {
      setDeleting(false);
    }
  };
  const logout = async () => {
    try {
      await api('/auth/logout', json('POST'));
      setProject(null);
      setConcept(null);
      conceptRef.current = null;
      selectedRef.current = null;
      await bootstrap();
      setDialog(null);
      notify('로그아웃했어요.');
    } catch (error) {
      notify(errorMessage(error));
    }
  };
  if (!boot)
    return (
      <div className="app-loading">
        <div className="brand">
          <SlothMark />
          <span>
            EmotiStudio<span className="brand-dot">.</span>
          </span>
        </div>
        {initialError ? (
          <ErrorNotice
            message={initialError}
            retry={() => {
              void bootstrap().catch((error) => setInitialError(errorMessage(error)));
            }}
          />
        ) : (
          <Spinner label="당신의 작업실을 열고 있어요" />
        )}
      </div>
    );
  const projects = boot.projects
    .filter(
      (item) =>
        (section !== 'completed' || item.status === 'completed') &&
        (filter === 'all' ||
          (filter === 'active' ? item.status !== 'completed' : item.status === filter)) &&
        `${item.name} ${item.characterName} ${item.concept}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'ko')
        : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  const visibleConcepts = (boot.concepts ?? [])
    .filter(
      (item) =>
        `${item.name} ${item.characterName} ${item.concept}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()) &&
        (filter === 'all' ||
          boot.projects.some(
            (project) =>
              project.conceptId === item.id &&
              (filter === 'active'
                ? project.status !== 'completed'
                : project.status === 'completed'),
          )),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name, 'ko')
        : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  const allCount = boot.projects.length;
  const completedCount = boot.projects.filter((item) => item.status === 'completed').length;
  const activeCount = allCount - completedCount;
  const sticker = project?.stickers.find((item) => item.id === stickerId);
  const detailVisible =
    project ||
    concept ||
    projectLoading ||
    conceptLoading ||
    selectedRef.current ||
    conceptRef.current;
  return (
    <div className="app-shell">
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="메뉴 닫기"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <button className="brand" onClick={() => navigate('workspace')} aria-label="EmotiStudio 홈">
          <SlothMark />
          <span>
            EmotiStudio<span className="brand-dot">.</span>
          </span>
        </button>
        <div className="workspace-switch">
          <span className="workspace-icon">✳</span>
          <div>
            <strong>나만의 크리에이티브 공간</strong>
            <span>PERSONAL WORKSPACE</span>
          </div>
        </div>
        <span className="nav-label">STUDIO</span>
        <nav aria-label="주 메뉴">
          <button
            className={section === 'workspace' ? 'active' : ''}
            onClick={() => navigate('workspace')}
          >
            <Grid2X2 size={19} />
            <span>내 작업실</span>
            <span className="nav-count">{boot.concepts?.length ?? 0}</span>
          </button>
          <button
            className={section === 'library' ? 'active' : ''}
            onClick={() => navigate('library')}
          >
            <Layers3 size={19} />
            <span>모든 캐릭터</span>
          </button>
          <button
            className={section === 'completed' ? 'active' : ''}
            onClick={() => navigate('completed')}
          >
            <FolderHeart size={19} />
            <span>완성한 이모티콘</span>
            {completedCount > 0 && <span className="nav-count">{completedCount}</span>}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <span className="note-spark">✦</span>
            <p>
              일상의 작은 감정도
              <br />
              누군가에겐 특별한 이야기.
            </p>
            <span>MAKE SOMETHING THAT FEELS.</span>
          </div>
          <button className="sidebar-utility" onClick={() => setDialog('help')}>
            <CircleHelp size={18} />
            도움말 및 가이드
            <ArrowRight size={15} />
          </button>
          <button className="sidebar-utility" onClick={() => setDialog('settings')}>
            <Settings2 size={18} />
            설정
          </button>
          <div className="account">
            <span className="account-avatar">
              {boot.user.isGuest ? 'G' : boot.user.name.slice(0, 1)}
            </span>
            <div>
              <strong>{boot.user.isGuest ? '게스트 작가님' : `${boot.user.name} 작가님`}</strong>
              <span>{boot.user.isGuest ? '나만의 이야기를 시작해요' : '나만의 작업실'}</span>
            </div>
            <button
              className="icon-button"
              onClick={() => setDialog(boot.user.isGuest ? 'auth' : 'settings')}
              aria-label={boot.user.isGuest ? '계정 만들기' : '계정 설정'}
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="메뉴 열기"
              onClick={() => setSidebar(true)}
            >
              <Menu size={22} />
            </button>
            <span>
              {detailVisible
                ? '나의 크리에이티브 스튜디오'
                : section === 'workspace'
                  ? '내 작업실'
                  : section === 'library'
                    ? '모든 캐릭터'
                    : '완성한 이모티콘'}
            </span>
            <span className="topbar-slash">/</span>
            <span className="topbar-caption">좋은 아이디어가 자라는 곳</span>
          </div>
          <div className="topbar-right">
            <span className="saved-label">
              <span className="connection-dot" />
              워크스페이스 연결됨
            </span>
            {boot.user.isGuest && (
              <button className="topbar-account" onClick={() => setDialog('auth')}>
                작업 보관하기
                <ArrowRight size={14} />
              </button>
            )}
          </div>
        </header>
        <main>
          {pageError && (
            <ErrorNotice
              message={pageError}
              retry={() => {
                void (
                  selectedRef.current
                    ? openProject(selectedRef.current)
                    : conceptRef.current
                      ? openConcept(conceptRef.current)
                      : refreshProjects()
                ).catch((error) => setPageError(errorMessage(error)));
              }}
            />
          )}
          {projectLoading || conceptLoading ? (
            <div className="page-loading">
              <Spinner label="작업을 불러오고 있어요" />
            </div>
          ) : project ? (
            <ProjectView
              key={project.id}
              project={project}
              liveGeneration={boot.capabilities.liveGeneration}
              onBack={() => {
                if (project.conceptId) void openConcept(project.conceptId);
                else navigate(section);
              }}
              onUpdated={updated}
              onRefresh={refreshDetail}
              onEdit={() => setDialog('edit')}
              onDelete={() => {
                setDeleteError('');
                setDialog('delete');
              }}
              onExport={() => setDialog('export')}
              onSticker={(item) => setStickerId(item.id)}
            />
          ) : concept ? (
            <ConceptWorkspace
              concept={concept}
              onBack={() => navigate(section)}
              onAdd={() => setDialog('newSet')}
              onEdit={() => setDialog('editConcept')}
              onOpen={(id) => {
                void openProject(id);
              }}
            />
          ) : (
            !selectedRef.current &&
            !conceptRef.current && (
              <div className="dashboard">
                {section === 'workspace' && (
                  <>
                    <div className="welcome-row">
                      <div>
                        <span className="eyebrow">YOUR LITTLE CREATIVE STUDIO</span>
                        <h1>
                          반가워요, {boot.user.isGuest ? '작가님' : `${boot.user.name} 작가님`}
                          <span className="greeting-dot">.</span>
                        </h1>
                        <p>오늘은 어떤 마음을 그려볼까요?</p>
                      </div>
                      <div className="date-label">
                        <span>조금씩, 나답게.</span>
                        <span>LET’S MAKE IT EMOTIONAL</span>
                      </div>
                    </div>
                    <section className="hero">
                      <div className="hero-copy">
                        <span className="hero-kicker">
                          <span />
                          FROM A LITTLE IDEA TO A LITTLE JOY
                        </span>
                        <h2>
                          작은 감정이,
                          <br />
                          나만의 이모티콘으로.
                        </h2>
                        <p>
                          머릿속에만 있던 캐릭터를 만나보세요.
                          <br />
                          컨셉부터 완성까지, 함께 만들어요.
                        </p>
                        <button className="button dark" onClick={() => setDialog('new')}>
                          <Plus size={18} />새 캐릭터 컨셉
                          <ArrowRight size={17} />
                        </button>
                      </div>
                      <div className="hero-art" aria-hidden="true">
                        <span className="hero-orbit orbit-one" />
                        <span className="hero-orbit orbit-two" />
                        <span className="hero-spark spark-one">✳</span>
                        <span className="hero-spark spark-two">✦</span>
                        <span className="floating-word word-one">안녕, 오늘도 ☺</span>
                        <img src="/samples/hello.png" alt="" />
                        <span className="floating-word word-two">느려도 괜찮아</span>
                        <span className="hero-art-label">MEET YOUR NEXT CHARACTER</span>
                      </div>
                      <div className="hero-bottom-tag">
                        <span />
                        MADE WITH A LITTLE IMAGINATION
                      </div>
                    </section>
                    <div className="stats-row">
                      <div>
                        <span className="stat-icon">
                          <Layers3 size={18} />
                        </span>
                        <span>캐릭터 컨셉</span>
                        <strong>
                          {boot.concepts?.length ?? 0}
                          <small>개</small>
                        </strong>
                      </div>
                      <div>
                        <span className="stat-icon">
                          <Pencil size={18} />
                        </span>
                        <span>작업 중인 세트</span>
                        <strong>
                          {activeCount}
                          <small>개</small>
                        </strong>
                      </div>
                      <div>
                        <span className="stat-icon">
                          <FolderHeart size={18} />
                        </span>
                        <span>완성한 세트</span>
                        <strong>
                          {completedCount}
                          <small>개</small>
                        </strong>
                      </div>
                      <span className="stats-note">
                        <Cloud size={16} />
                        작업은 자동으로 저장돼요
                      </span>
                    </div>
                  </>
                )}
                <section className="projects-section">
                  <div className="section-title">
                    <div>
                      <span className="eyebrow">
                        {section === 'completed'
                          ? 'FINISHED WITH LOVE'
                          : 'A COLLECTION OF YOUR IDEAS'}
                      </span>
                      <h2>
                        {section === 'workspace'
                          ? '나의 캐릭터 이야기'
                          : section === 'library'
                            ? '모든 캐릭터'
                            : '완성한 이모티콘'}
                        <span className="title-count">
                          {section === 'completed' ? completedCount : (boot.concepts?.length ?? 0)}
                        </span>
                      </h2>
                    </div>
                    <button
                      className="button secondary small-button"
                      onClick={() => setDialog('new')}
                    >
                      <Plus size={16} />새 캐릭터 컨셉
                    </button>
                  </div>
                  <div className="projects-toolbar">
                    <div className="filter-tabs">
                      {[
                        ['all', '전체'],
                        ['active', '작업 중'],
                        ['completed', '완료'],
                      ]
                        .filter(([key]) => section !== 'completed' || key === 'all')
                        .map(([key, label]) => (
                          <button
                            key={key}
                            className={filter === key ? 'active' : ''}
                            onClick={() => setFilter(key)}
                          >
                            {label}
                            {key === 'all' && (
                              <span>
                                {section === 'completed'
                                  ? completedCount
                                  : (boot.concepts?.length ?? 0)}
                              </span>
                            )}
                          </button>
                        ))}
                    </div>
                    <div className="project-search-sort">
                      <label className="search-input">
                        <Search size={16} />
                        <input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="캐릭터와 컨셉 검색"
                          aria-label="캐릭터와 컨셉 검색"
                        />
                        {query && (
                          <button
                            className="icon-button"
                            aria-label="검색 지우기"
                            onClick={() => setQuery('')}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </label>
                      <label className="sort-select">
                        <SlidersHorizontal size={15} />
                        <select
                          aria-label="컨셉 정렬"
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          <option value="recent">최근 수정순</option>
                          <option value="name">이름순</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  {(section === 'completed' ? projects.length : visibleConcepts.length) > 0 ? (
                    <div className="project-grid">
                      {section === 'completed'
                        ? projects.map((item, index) => (
                            <SetCard
                              key={item.id}
                              project={item}
                              index={index}
                              onOpen={() => {
                                void openProject(item.id);
                              }}
                            />
                          ))
                        : visibleConcepts.map((item, index) => (
                            <button
                              className="project-card concept-card"
                              key={item.id}
                              onClick={() => {
                                void openConcept(item.id);
                              }}
                              aria-label={`${item.name} 컨셉 열기`}
                            >
                              <div className={`project-card-cover cover-${index % 3}`}>
                                <span className="concept-card-type">캐릭터 컨셉</span>
                                {item.coverUrl || item.referenceUrl ? (
                                  <img
                                    src={item.referenceUrl ?? item.coverUrl ?? ''}
                                    alt={item.characterName}
                                  />
                                ) : item.builtinCharacter ? (
                                  <img
                                    src={
                                      CHARACTER_PRESETS.find(
                                        (preset) => preset.id === item.builtinCharacter,
                                      )?.image
                                    }
                                    alt={item.characterName}
                                  />
                                ) : (
                                  <div className="placeholder-art">
                                    <Sparkles size={35} />
                                    <span>작은 상상이 시작되는 곳</span>
                                  </div>
                                )}
                                <span className="card-open-icon">
                                  <ArrowRight size={18} />
                                </span>
                              </div>
                              <div className="project-card-content">
                                <div className="project-card-name">
                                  <h3>{item.name}</h3>
                                  <span>{item.characterName}</span>
                                </div>
                                <p>{item.concept}</p>
                                <div className="project-card-meta">
                                  <span>
                                    <Layers3 size={14} />
                                    {item.projectCount}개 세트 · {item.stickerCount}개 이모티콘
                                  </span>
                                  <time dateTime={item.updatedAt}>{date(item.updatedAt)}</time>
                                </div>
                              </div>
                            </button>
                          ))}
                      {section !== 'completed' && (
                        <button className="new-project-card" onClick={() => setDialog('new')}>
                          <span>
                            <Plus size={24} />
                          </span>
                          <strong>다음 캐릭터를 만나보세요</strong>
                          <p>하나의 컨셉, 여러 개의 이야기</p>
                          <span className="new-project-cta">
                            새 캐릭터 컨셉
                            <ArrowRight size={15} />
                          </span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <span>
                        <FolderHeart size={34} />
                      </span>
                      <h3>
                        {query
                          ? '아직 이 이야기를 찾지 못했어요'
                          : section === 'completed'
                            ? '완성된 이야기를 기다리고 있어요'
                            : '첫 번째 캐릭터를 만나보세요'}
                      </h3>
                      <p>
                        {query
                          ? '다른 이름이나 키워드로 검색해 보세요.'
                          : section === 'completed'
                            ? '세트를 검수하고 완료하면 여기에 모여요.'
                            : '캐릭터의 특징을 정하고 여러 감정 세트를 만들어보세요.'}
                      </p>
                      <button
                        className="button secondary"
                        onClick={() =>
                          query
                            ? setQuery('')
                            : section === 'completed'
                              ? navigate('workspace')
                              : setDialog('new')
                        }
                      >
                        {query
                          ? '검색 초기화'
                          : section === 'completed'
                            ? '내 작업실로 가기'
                            : '새 캐릭터 컨셉'}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                </section>
                <section className="process-strip">
                  <div className="process-strip-title">
                    <Sparkles size={20} />
                    <strong>아이디어에서 이모티콘까지</strong>
                    <span>나만의 속도로, 한 걸음씩.</span>
                  </div>
                  <div>
                    {['컨셉 잡기', '방향 선택', '이모티콘 생성', '검수 및 완성'].map(
                      (step, index) => (
                        <span key={step}>
                          <small>0{index + 1}</small>
                          {step}
                          {index < 3 && <ChevronRight size={13} />}
                        </span>
                      ),
                    )}
                  </div>
                  <button onClick={() => setDialog('help')} aria-label="제작 가이드 보기">
                    <ArrowRight size={20} />
                  </button>
                </section>
                <footer className="page-footer">
                  <span>EMOTISTUDIO — LITTLE EMOTIONS, BIG STORIES.</span>
                  <span>당신의 모든 작은 상상을 응원해요.</span>
                </footer>
              </div>
            )
          )}
        </main>
      </div>
      {dialog === 'new' && <CharacterConceptForm onSave={create} onClose={() => setDialog(null)} />}
      {dialog === 'editConcept' && concept && (
        <CharacterConceptForm
          concept={concept}
          onSave={editConcept}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'newSet' && concept && (
        <NewSetForm concept={concept} onSave={createSet} onClose={() => setDialog(null)} />
      )}
      {dialog === 'edit' && project && (
        <ConceptForm project={project} onSave={edit} onClose={() => setDialog(null)} />
      )}
      {dialog === 'auth' && (
        <AuthForm
          onClose={() => setDialog(null)}
          onSuccess={async () => {
            await bootstrap();
            setProject(null);
            setConcept(null);
            conceptRef.current = null;
            selectedRef.current = null;
            setDialog(null);
            notify('작업실이 계정에 연결됐어요.');
          }}
        />
      )}
      {dialog === 'export' && project && (
        <ExportModal project={project} onClose={() => setDialog(null)} />
      )}
      {dialog === 'delete' && project && (
        <Modal
          title="이 프로젝트를 삭제할까요?"
          onClose={() => {
            if (!deleting) setDialog(null);
          }}
        >
          <p className="modal-intro">
            <strong>{project.name}</strong>의 이모티콘, 수정 이력, 작업 기록이 모두 삭제돼요. 삭제한
            프로젝트는 되돌릴 수 없어요.
          </p>
          {deleteError && <ErrorNotice message={deleteError} />}
          <div className="modal-footer">
            <button
              className="button secondary"
              disabled={deleting}
              onClick={() => setDialog(null)}
            >
              취소
            </button>
            <button
              className="button danger"
              disabled={deleting}
              onClick={() => {
                void remove();
              }}
            >
              {deleting ? <Spinner label="삭제 중" /> : '프로젝트 삭제'}
            </button>
          </div>
        </Modal>
      )}
      {dialog === 'settings' && (
        <Modal title="작업실 설정" onClose={() => setDialog(null)}>
          <div className="settings-section">
            <span className="eyebrow">MY ACCOUNT</span>
            <div className="settings-row">
              <div>
                <strong>{boot.user.isGuest ? '게스트 작업실' : boot.user.name}</strong>
                <p>
                  {boot.user.isGuest
                    ? '현재 브라우저에서 작업을 이어갈 수 있어요.'
                    : boot.user.email}
                </p>
              </div>
              {boot.user.isGuest ? (
                <button className="button secondary small-button" onClick={() => setDialog('auth')}>
                  계정 만들기
                </button>
              ) : (
                <button
                  className="text-button"
                  onClick={() => {
                    void logout();
                  }}
                >
                  <LogOut size={16} />
                  로그아웃
                </button>
              )}
            </div>
            {boot.user.isGuest && (
              <p className="field-hint">
                브라우저 쿠키를 지우면 게스트 작업실에 다시 접근할 수 없어요. 계정을 만들어 작업을
                보관해 주세요.
              </p>
            )}
          </div>
          <div className="settings-section">
            <span className="eyebrow">GENERATION</span>
            <div className="settings-row">
              <div>
                <strong>AI 이미지 생성</strong>
                <p>
                  {boot.capabilities.liveGeneration
                    ? '서버의 이미지 생성 서비스가 연결되어 있어요.'
                    : '캐릭터 프리셋으로 이모티콘을 만들 수 있어요.'}
                </p>
              </div>
              <span
                className={`connection-badge ${boot.capabilities.liveGeneration ? 'connected' : ''}`}
              >
                {boot.capabilities.liveGeneration ? '연결됨' : '연결 필요'}
              </span>
            </div>
            <p className="field-hint">
              {boot.capabilities.liveGeneration
                ? `사용 모델: ${boot.capabilities.imageModel}`
                : '새 이미지를 생성하려면 운영자가 서버에서 AI 서비스를 연결해야 해요.'}
            </p>
          </div>
          <div className="settings-section">
            <span className="eyebrow">STORAGE</span>
            <div className="settings-row">
              <div>
                <strong>작업 자동 저장</strong>
                <p>프로젝트, 승인 상태, 이미지 버전이 서버에 저장돼요.</p>
              </div>
              <Cloud size={21} />
            </div>
          </div>
        </Modal>
      )}
      {dialog === 'help' && (
        <Modal title="작은 상상을 완성하는 방법" onClose={() => setDialog(null)}>
          <p className="modal-intro">컨셉을 정하고, 표정을 만들고, 마음에 들 때까지 다듬어요.</p>
          <div className="help-steps">
            {[
              [
                '캐릭터의 이야기를 들려주세요',
                '늘보군·토끼찬구를 고르거나 외모, 성격, 말투를 직접 적어 메인 캐릭터 컨셉을 만들어요. 같은 컨셉 아래 정지 32개·움직이는 24개 세트를 여러 개 추가할 수 있어요.',
              ],
              [
                '원하는 방향을 골라주세요',
                '컨셉 키워드에 맞춘 추천 방향을 고르거나 직접 작성해요. 추천은 정해진 규칙을 바탕으로 제안돼요.',
              ],
              [
                '표정들을 만나보세요',
                '캐릭터 프리셋은 상황마다 다른 포즈와 부위 움직임을 사용해요. 대사를 넣으면 이미지에도 함께 저장돼요. AI 연결 시 직접 쓴 컨셉과 동작을 해석해 새 그림을 만들 수 있어요.',
              ],
              [
                '검수하고 완성해요',
                '움직임을 재생하거나 각 프레임을 넘겨 보고 첫·마지막 자세가 이어지는지 확인해요. 수정 의견을 기록하고 AI 모드에서는 의견을 반영한 새 버전을 만들 수 있어요. 완료 후 PNG 또는 움직이는 WebP/GIF와 정지 PNG를 ZIP으로 내려받아요.',
              ],
            ].map(([title, description], index) => (
              <div key={title}>
                <span>{index + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="tip-box">
            <CircleHelp size={18} />
            <p>
              개별 수정은 선택한 이모티콘에만 적용돼요. 프리셋 수정은 같은 감정의 새 포즈를
              사용하고, AI 수정은 직접 쓴 의견을 반영해요. AI 영역 밖은 생성된 첫 프레임으로
              고정하므로 원본과의 일치와 자연스러움은 검수에서 확인해 주세요.
            </p>
          </div>
          <div className="platform-guidance">
            <h3>카카오 기준 수량을 참고해요</h3>
            <p>
              정지 32개, 움직이는 24개로 만들어요. 수량과 별개로 카카오는 생성형 AI 활용 제안을
              제한하고 있어요. 움직이는 이모티콘은 공식 전용 도구로 다시 인코딩하고 아이콘·파일 용량
              등 최신 요건도 확인해야 해요.
            </p>
            <div>
              <a href="https://emoticonstudio.kakao.com/guideline" target="_blank" rel="noreferrer">
                운영 가이드
              </a>
              <a
                href="https://kakaoemoticonstudio.notion.site/emoticon"
                target="_blank"
                rel="noreferrer"
              >
                정지 이모티콘
              </a>
              <a
                href="https://kakaoemoticonstudio.notion.site/animated-emoticon"
                target="_blank"
                rel="noreferrer"
              >
                움직이는 이모티콘
              </a>
            </div>
          </div>
          <button className="button primary full-width" onClick={() => setDialog(null)}>
            이제 만들어볼게요
            <ArrowRight size={17} />
          </button>
        </Modal>
      )}
      {sticker && project && (
        <StickerModal
          key={sticker.id}
          sticker={sticker}
          project={project}
          liveGeneration={boot.capabilities.liveGeneration}
          onClose={() => setStickerId(null)}
          onUpdated={updated}
          onJob={refreshDetail}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button className="icon-button" aria-label="알림 닫기" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
