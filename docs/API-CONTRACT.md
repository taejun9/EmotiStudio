# API contract

JSON success bodies contain the response directly; errors use `{error:string, code?:string}`. Requests use the same-origin session cookie. All concept, project, sticker and private asset routes check ownership. Types are defined in `shared/types.ts` and validation in `server/app.ts`.

## Accounts and bootstrap

| Method | Route                | Result                                                                                                         |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`        | Read-only health response; creates no guest workspace.                                                         |
| GET    | `/api/bootstrap`     | `{user, concepts, projects, capabilities}`; creates an isolated guest session if needed.                       |
| POST   | `/api/auth/register` | `{name,email,password}` → `{user}`; promotes the guest while preserving work.                                  |
| POST   | `/api/auth/login`    | `{email,password}` → `{user}`; moves the current guest's meaningful concepts, sets and uploads to the account. |
| POST   | `/api/auth/logout`   | `{ok:true}`.                                                                                                   |

Login during an active guest generation job returns `409 GENERATION_ACTIVE`; login succeeds after the job ends. An untouched duplicate tutorial set is omitted during merge. The initial six-image tutorial is a legacy example, not the composition of a newly generated set.

## Parent character concepts and sets

`CreateConceptInput` requires `name` (1–100), `characterName` (1–60), and `concept` (1–3000). Optional fields are `personality` (0–500), `audience` (0–300), `referenceUrl:string|null`, and `builtinCharacter:'neulbo'|'tokki'|null`. If the built-in field is omitted, the server may infer a known preset from the character name.

| Method | Route                        | Body / result                                                                                                                             |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/concepts`              | `CharacterConcept[]`, newest update first.                                                                                                |
| POST   | `/api/concepts`              | `CreateConceptInput` → `201 ConceptDetail`.                                                                                               |
| GET    | `/api/concepts/:id`          | `ConceptDetail`, including child `projects`.                                                                                              |
| PATCH  | `/api/concepts/:id`          | Nonempty partial `CreateConceptInput` → `ConceptDetail`.                                                                                  |
| DELETE | `/api/concepts/:id`          | `{ok:true}`; nonempty parents return `409 CONCEPT_NOT_EMPTY`.                                                                             |
| POST   | `/api/concepts/:id/projects` | `{name,format:'static' or 'animated',captionsEnabled?:boolean,actionPrompt?:string}` → `201 ProjectDetail`.                               |
| GET    | `/api/projects`              | `Project[]`.                                                                                                                              |
| POST   | `/api/projects`              | Compatibility `CreateProjectInput` → `201 ProjectDetail`. Creates a parent if `conceptId` is absent; otherwise inherits the owned parent. |
| GET    | `/api/projects/:id`          | `ProjectDetail`, with versions and activities.                                                                                            |
| PATCH  | `/api/projects/:id`          | Nonempty partial `CreateProjectInput` → `ProjectDetail`.                                                                                  |
| DELETE | `/api/projects/:id`          | `{ok:true}`; removes the set while retaining files still referenced elsewhere.                                                            |

A set copies the parent's character fields at creation. Editing the parent affects future sets; existing sets retain their own saved concept and reference. A set cannot change its parent (`CONCEPT_LOCKED`). The server derives `targetCount`: **32 static, 24 animated**. Format and built-in character are locked once stickers exist. Old sets keep their original target count and `isLegacy` flag. `motionPreset` remains a compatibility field for older versions.

The compatibility `CreateProjectInput` also requires `name`, `characterName`, `concept`; it accepts the optional concept fields plus `conceptId`, `format`, `captionsEnabled`, `actionPrompt` and legacy `motionPreset`. Use the parent-specific creation route for new clients. Each account can keep up to 100 concepts and 100 sets.

## References, directions and generation

| Method | Route                          | Body / result                                                              |
| ------ | ------------------------------ | -------------------------------------------------------------------------- |
| POST   | `/api/uploads`                 | Multipart `file` → `{url}`; validates and normalizes PNG/JPEG/WebP images. |
| POST   | `/api/projects/:id/directions` | `Direction[]`; deterministic concept-aware templates, not an LLM call.     |
| PUT    | `/api/projects/:id/direction`  | `{direction:Direction}` → `ProjectDetail`; custom directions are accepted. |
| POST   | `/api/projects/:id/generate`   | `{provider:'sample' or 'openai',count?:number}` → `202 {job}`.             |
| GET    | `/api/projects/:id/job`        | `{job:GenerationJob or null}`.                                             |

Generation requires a selected direction. Omitted `count` means the saved target; a different count is rejected. A concurrent job is rejected with 409. Retrying after a partial failure fills only missing positions; it does not duplicate already saved stickers. `requestedCount` is the final set size, while `total` is the number of items attempted by that job.

`sample` is the code-native preset provider. `server/character-art.ts` renders **32 distinct scenes per character**, or the first **24 scenes with local animation**, from `shared/sticker-plans.ts`. The characters are `neulbo` and `tokki`. A custom concept without a preset uses the disclosed Neulbo preview. Sample rendering makes no image-generation API call and does not interpret arbitrary concept, feedback or action text. Sample provenance remains `provider:'sample'` and is recorded in version prompts and exports.

`openai` uses one image request per static image or eight-pose animation sheet. It requires a registered account, configured key, optional email allowlist, account quota and global quota. Quotas survive project deletion. Reservations are made before a batch; unattempted requests are released if it stops, while attempted requests remain counted. Historical motion-only jobs and caption-only jobs do not consume AI request quota.

Live output must have transparency. An animation response must be a valid 4×2 grid of square cells. A decoded pixel hash detects exact duplicate art already stored under another sticker in the same set; duplicates fail before saving. This does not detect all visually similar images. A saved frame atlas cannot be used as an arbitrary identity reference; it is accepted only as the owned current sticker's revision input.

## Individual review and versions

| Method | Route                                     | Body / result                                                                                                                         |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| PATCH  | `/api/projects/:id/stickers/:sid`         | Any nonempty combination of `status`, `feedback`, `title` → `ProjectDetail`. Status is `approved`, `pending`, or `changes_requested`. |
| POST   | `/api/projects/:id/stickers/:sid/revise`  | `{feedback:string,provider}` → `202 {job}`.                                                                                           |
| POST   | `/api/projects/:id/stickers/:sid/animate` | `{provider,actionPrompt,region?:{x,y,width,height} or null}` → `202 {job}`; animated sets only.                                       |
| POST   | `/api/projects/:id/stickers/:sid/caption` | `{enabled:boolean,text?:string}` → `202 {job}`; no image API request.                                                                 |
| POST   | `/api/projects/:id/stickers/:sid/restore` | `{version:number}` → `ProjectDetail`; resets approval to pending.                                                                     |
| POST   | `/api/projects/:id/stickers/:sid/motion`  | `410 LEGACY_MOTION_REMOVED`; whole-picture transform generation is retired.                                                           |

Image revisions target exactly one sticker and preserve its scene (`poseId` / original position). Sample revisions use an authored expression-and-paw variation of the same scene; they do not replace the sticker with the next unrelated scene. Only completed image/action revisions count toward the variation number; caption-only jobs do not. Live revisions use the clean current art plus feedback. A new version is appended and approval resets to pending; earlier versions remain available.

For animated live revisions, the server extracts the first timeline pose from the **clean** atlas for positioning and sends the clean atlas as the correction target. The prompt identifies the visible review frame numbers and their atlas cells. Image revision preserves the existing `sequence` and `delaysMs`; a new action creates a new timeline. `sourceUrl` retains the original independent reference. Region coordinates are normalized to 0–1 and must remain inside the frame. A region freezes the outside to the generated first frame, not to the uploaded PNG. Preset animations use their authored rig and do not apply custom action text or live masks.

Caption text is optional when enabling: the current text is reused, or the scene's default caption is selected. Supplied text must be nonempty after trimming and at most 24 characters under API validation. Caption rendering normalizes Unicode and rejects hidden control characters. Disabling sets `caption:null`. Every operation starts from `cleanImageUrl`, so repeated on/off/edit operations do not accumulate lettering or shrink the artwork. Captions are baked into the PNG and every animation frame using the bundled Noto Sans KR font, with a separate text band. Caption-only jobs retain provider and pose provenance but skip live-generation access and quota checks. A legacy whole-picture animation without frame metadata returns `409 FRAME_ANIMATION_REQUIRED`.

A set with an incomplete batch must finish generation before individual image, action or caption changes (`BATCH_INCOMPLETE`). Completed sets must be reopened to edit.

## Media and persistence

`Project` includes `conceptId`, `builtinCharacter`, `captionsEnabled`, `format`, `targetCount`, `isLegacy`, `actionPrompt` and legacy `motionPreset`. `captionsEnabled` controls default captions during new generation; changing it does not rewrite existing versions.

Each `StickerVersion` includes:

- `imageUrl`: static PNG or animated WebP actually displayed/exported.
- `posterUrl`: still preview of that version, including its caption if enabled.
- `sourceUrl`: original character reference retained across image revisions.
- `cleanImageUrl`: caption-free PNG for static images; processed, caption-free PNG atlas for frame animations.
- `caption:string|null`, `poseId:string|null`, provider, prompt, feedback and creation time.
- Nullable `gifUrl`, nullable legacy `motionPreset`, actual WebP `frameCount`, `durationMs`, and nullable `animation`.

Stickers expose their current version's caption, pose, playback fields and version history. `animation` is `{kind:'frames',sheetUrl,columns,rows,frameWidth,frameHeight,frameCount,sequence,delaysMs,actionPrompt,region,warnings?}`. `sheetUrl` is the atlas used for visible review, including captions when enabled. `sequence` maps timeline steps to zero-based atlas cells, and `delaysMs` specifies their durations. Current providers use eight source cells; the frame engine accepts up to 24 cells/timeline entries. Encoders can merge identical adjacent frames, so encoded WebP and GIF counts can differ. GIF exports inspect the actual GIF metadata.

All `/api/assets/:filename` PNG/WebP/GIF requests enforce ownership. Concepts, projects, clean images and version atlases are included in reference-retention checks when removing a set. SQLite migrations add parent concepts and media fields while preserving legacy images, versions and original set sizes. Restore moves the current version pointer without deleting newer versions. Dates are ISO strings; lists use descending update/creation order where applicable.

## Completion and export

| Method | Route                                           | Result                                                                                  |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| POST   | `/api/projects/:id/approve-all`                 | `ProjectDetail`.                                                                        |
| POST   | `/api/projects/:id/complete`                    | `ProjectDetail`; complete target count and all approvals required.                      |
| POST   | `/api/projects/:id/reopen`                      | `ProjectDetail`.                                                                        |
| GET    | `/api/projects/:id/export?size=360&format=png`  | Static ZIP: individual PNGs and manifest; 720 and 1024 are also accepted.               |
| GET    | `/api/projects/:id/export?size=360&format=webp` | Animated ZIP: animation files, PNG posters and manifest; `format=gif` is also accepted. |
| GET    | `/api/projects/:id/export-manifest`             | Manifest JSON; same completion, size and format checks.                                 |

Animated exports are 360px only and default to WebP. Static exports default to PNG. Manifest format version 4 records parent concept, preset character, caption defaults, per-sticker `poseId`, `caption`, `cleanImageUrl`, provider provenance, version and animation metadata. A completed set means the user approved its contents; it is not a platform submission approval.
