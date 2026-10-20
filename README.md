# Stair Dismount — Impact Laboratory

An independent browser recreation inspired by **Porrasturvat (Stair Dismount, 2002)**. Pick a push point, aim, time the power meter, and send a crash-test dummy tumbling down a choice of stair layouts.

## Play

Open `index.html` in a modern browser. No installation, build step, or network connection is required. The JavaScript physics engine is included locally in `vendor/`.

Optionally serve the folder:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then visit `http://localhost:8000`.

**Mouse controls:** press anywhere on the stage. Hold still to charge the power meter, or drag right toward the stairs to set power by distance and adjust the angle. Release to push; release is handled even outside the canvas. Starting on empty space uses the currently selected body part; starting on the dummy selects the nearby body part. Drag up/down to aim and farther for more power (180 pixels = full power). The push arrow changes smoothly from green at low power through yellow to red at full power, during both dragging and charging. A short click on the dummy only selects the part; a short click on empty space does not push. Cancel a drag with Reset or by switching away from the window. Touch dragging is also supported.

Alternatively, use the power meter:

1. Select a body part in the dropdown, or click it on the dummy. Both feet are available; foot pushes apply to the selected foot itself.
2. Adjust the angle from −100° to 100°; 90° pushes vertically up and angles above 90° push slightly backward. Drag up and left to reach 100°, or down and left to reach −100°. Older saved replays retain their original angles.
3. Hold **Hold to charge** and release the mouse button at the desired power. Alternatively, use two short clicks: the first starts charging and the second pushes. Space also starts/releases when focus is outside a form control.
4. Watch the damage report. Head impacts earn a larger multiplier.
5. After a fall, click anywhere on the stage to try again. You can also reset with **R** or **Reset**; use **Replay** to watch the last completed experiment.

For a gravity-only fall, click **↓ Drop · 0%**. Zero power adds no push; the dummy collapses according to gravity, balance, and contacts.

Toggle half speed and side/perspective views using the controls. Impact sounds use six procedural texture variants, with different timbres for the head, torso, arms, and legs. Stair edges add sharp snaps; heavy flat landings add a gritty tail. Dislocations layer deeper crunches over cracking sounds. A compressor controls overlapping effects. Sound is enabled by default and unlocks on the first push interaction. The SOUND button mutes/unmutes all effects: selection, charging, launch, collisions, bone-cracking effects, and completion. Recorded impacts also play during replay. Your best score is saved locally when browser storage is available. Reset preserves the previous recording until you launch another attempt.

## Layouts and motion effects

Choose a layout before starting: **Classic** (14 steps), **Short & steep** (8), **Long & shallow** (18), **Split flight** (14 with a wide intermediate landing), **Uneven Steps**, **The Shaft**, **Endless Stairs** (the default), or **Final Drop**. The selector is locked during a push or replay. Switching layouts resets the scene and clears the last-attempt recording; saved leaderboard replays remain available in their own layout.

**MOTION FX** toggles smooth camera tracking, subtle screen shake, and brief automatic slow motion on strong impacts. The camera stays fixed while aiming and smoothly returns to the overview after a run. Effects change presentation only; fixed-step physics and scores stay the same. Effects start off by default; click MOTION FX to enable them. The half-speed button controls live experiments; replay has its own speed selector.

### Additional chambers

| Chamber | Geometry | Approach |
| --- | --- | --- |
| Uneven Steps | 14 alternating short/tall and narrow/wide steps | Try different angles to change which edges catch the dummy. |
| The Shaft | Five alternating ledges inside a deep vertical shaft | Push into the shaft; the finite ledges leave real open space below them. |
| Final Drop | Six steps followed by a 320-unit drop into a landing pit | Build enough forward momentum to clear the final edge. |

Choose any chamber from **Test chamber** before launching. Each has its own top-ten board, personal best, and saved replay recipes. Existing chambers and their stored records are preserved.

## Characters and shareable links

Choose **Test subject** in the welcome dialog or beside the chamber selector. **Human** is the default. Characters share the same articulated skeleton, with different procedural artwork, materials, mass, joint damping, and impact sounds:

| Character | URL value | Behavior |
| --- | --- | --- |
| Human | `human` | Original physics and anatomical limits. |
| Robot | `robot` | Heavy metal segments and stiff joints. |
| Knight | `knight` | Heavy armor, extra chest and helmet weight. |
| Skeleton | `skeleton` | Light bones and more fragile joints. |
| Inflatable dancer | `inflatable` | Very light tubes, loose joints and strong air resistance. |

Combine character and chamber in a link, for example `?chamber=7&character=robot` or `?chamber=shaft&character=skeleton`. Valid character links skip the welcome dialog. Missing or unknown characters fall back to Human. Selection updates the URL without reloading; choosing Human removes the optional `character` parameter.

Robot impacts use short metal resonances; knight armor rings longer. Skeleton impacts use dry clacks and snaps, while the inflatable subject uses soft thumps, rubber squeaks and air hiss. Impact strength, body part and stair edges vary the sound.

Each chamber/character combination has its own local leaderboard and personal best. Human retains the existing records and physics. Saved replays retain the chosen character. Changing either selector clears the current attempt; both selectors are locked during a fall or replay.

## High scores and saved replays

After a qualifying fall, enter exactly three letters (A–Z) and select **Save score**. Each chamber/character board retains its ten highest scores, with a **Replay** button for each entry. Lowercase initials become uppercase. Replaying never submits another score.

Scores and replay recipes persist in this browser using local storage (`dismount-scoreboard-v2` for Classic, with a layout suffix for other chambers and `-character-<id>` for non-human subjects). If storage is blocked or full, scores remain available for the current session and a message explains the limitation. This is a local leaderboard, not an online ranking; clearing browser data removes it.

Saved replays reconstruct the fall from the exact, unrounded push settings using the pinned physics version, then play the recorded frames with sound. Reset cancels preparation or playback. Replays from an incompatible physics version are disabled; reconstruction checks the final score, impact count, and duration before playback. Increment `REPLAY_VERSION` when changing simulation behavior. The ordinary Replay control retains your last attempt independently of leaderboard playback.

## Replay controls and retries

Open **Replay** or a leaderboard replay to show the controls below the stage. Pause/play, drag the timeline, step backward or forward one physics frame, jump to **Strongest impact**, and choose ¼×, ½×, 1×, or 2× speed. Seeking pauses playback and updates the damage map without replaying sound. The play button restarts a finished replay. Replay viewing and seeking never submit scores.

**Retry same push** repeats the exact stored body part, angle, and unrounded power. **Tweak last push** restores those settings and exposes a power slider; adjust the part, angle, or power, then choose **Push with these settings**. Both work with your last attempt or the saved replay currently being viewed. Switching chambers clears the retry selection. Historical replays with angles outside today’s −100° to 100° range can be tweaked into range; exact retry is disabled for those entries.

Contact rings and short labels identify **LANDING**, **EDGE**, **BODY CONTACT**, and **DISLOCATION** events. A compact stage notice names the body part or joint. Paused replay keeps the current frame’s markers visible; seeking elsewhere clears stale markers. These indicators work with Motion FX off.

## Body damage map

The report includes a body silhouette that updates during play and replay. Gray means no scored impacts; yellow through red indicates increasing cumulative damage to each body segment (the color saturates at 3,000 points). Click or tap a body segment to inspect its points, hit count, and connected joints (intact, strained, or dislocated). Keyboard users can focus a segment and press Enter or Space. The body-part dropdown provides the same inspection on small screens. Details update during play and replay; hovering also shows points and hits. Red joint dots and the text below identify dislocations. The highest-scoring impact shows its body part, points, and whether it struck a stair edge. Recovery meters show a fictional arcade estimate for the whole body and selected part, decreasing with cumulative impact points, joint strain, and dislocations. They do not simulate healing or predict medical outcomes. The same snapshot produces the same values in replay; reset restores both meters to 100%. Reset also clears the map.

## Implementation

- `index.html`: accessible native controls and page structure.
- `style.css`: responsive layout and visual styling.
- `src/physics.js`: rigid-body ragdoll, collision scoring, joint damage, and snapshot adapter.
- `src/character-art.js`: procedural Canvas artwork for the four alternative subjects.
- `vendor/`: pinned Planck.js 1.5.0 engine and its MIT license; see `vendor/README.md`.
- `src/scores.js`: validated top-ten storage and versioned replay recipes.
- `src/game.js`: Canvas rendering, push controls, report updates, and game state.
- `src/replay.js` and `src/replay-worker.js`: lossless numeric recordings and background reconstruction.
- `src/audio.js`: gesture-unlocked sound synthesis, volume and impact mixing.
- `src/fullscreen.js`: native fullscreen, fallback and the settings drawer.
- `src/subjects.js` and `src/challenges.js`: report themes and optional goals.
- `src/endless.js`: depth milestones, color palettes and local depth records.
- `tests/`: dependency-free Node.js regression tests.

The ragdoll consists of 17 rigid bodies: head, cervical segment, chest, abdomen, pelvis, eight limb segments, two hands, and two feet. Capsules (rectangles with circular end caps) collide along their entire length. Bodies have explicit masses, moments of inertia, linear and angular velocities. Pushes apply a localized impulse over 0.2 seconds; off-center pushes create torque. Gravity is 9.81 m/s² at 90 drawing units per meter.

Fifteen anatomical joint groups constrain elbows, knees, shoulders, hips, neck, wrists, ankles, and two spine articulations. Wrists bend ±65° from their starting orientation, ankles −35° to +50°, the thoracic articulation −20° to +25°, and the lumbar articulation −25° to +30°. These are simplified sagittal-plane game limits. Revolute limits are relative to the parent body; bounded motors provide angular damping. The neck additionally has a damped prismatic spring with limited extension. Collision trauma and measured reaction-force overload can dislocate joints, widening their angular limits while keeping the body attached. Injured joints still have stops: ankles −75° to +90°, wrists ±105°, elbows −190° to +40°, knees −40° to +185°, hips −160° to +75°, shoulders −215° to +85°, neck ±105°, thoracic spine −45° to +50°, and lumbar spine −50° to +55°. These are fictional injury constraints; no joint can spin continuously. Reset heals joints; replay stores exact body transforms and injury states.

Unconnected segments collide with one another, including opposite limbs. Directly connected neighbors and overlapping structural neighbors around the spine, hips, and shoulders are excluded to prevent thick joint ends from fighting the constraints. Continuous collision detection is enabled on dynamic bodies. Each 120 Hz game tick normally advances twelve solver substeps (1,440 Hz), using 24 velocity and 32 position iterations per substep. A push above 80% power to a hand or foot uses 24 substeps during its 0.2-second impulse to stabilize the small joint. This schedule depends only on the push, not device performance. These numerical constraints permit small temporary errors under severe loads; this remains an arcade 2D model, not biomechanics. The torso uses three segments rather than individual vertebrae; fingers and toes are not modeled separately.

Exposed stair edges concentrate damage up to 2.25× and add sharper rebounds and cracking sounds. Damage comes from real collision speeds and impulses; resting contact does not earn points. Noise synthesis does not affect physics. Identical inputs produce repeatable runs within the same engine/browser; bit-for-bit equality across different browser engines is not guaranteed.

The anatomy update starts a separate ranking because collision geometry and scores changed. Previous rankings remain in their original storage keys. Classic personal bests use the local-storage key `dismount-anatomy-best-v2`; other layouts use their own suffixed keys. Older personal bests remain stored but are not compared with these runs.

Physics is two-dimensional; perspective mode renders an extruded staircase. This is an original implementation with procedural artwork, not the original game's engine, assets, or full 3D camera system. Background tabs pause naturally rather than fast-forwarding the simulation on return.

## Rendering and responsiveness

Chamber geometry and DOM references are cached. Damage-report updates run at most 20 times per second while simulation frames remain at 120 Hz. Impact markers are capped at 32. Recordings keep static anatomy once and dynamic values in chunked Float64 arrays, preserving exact frame values. Saved-replay reconstruction runs in a Web Worker over HTTP(S), with short main-thread chunks as a fallback for local files or unavailable workers. Reset terminates an active worker; the most recently completed saved replay stays cached for instant reopening. The previous completed attempt can also be retained as a ghost. Solver iterations remain unchanged; strong hand/foot pushes temporarily use finer integration. `node scripts/profile.cjs` reports simulation-plus-snapshot timings for the same chest push across all eight chambers. A local sample measured 3.33–4.25 ms at the 95th percentile against an 8.33 ms tick budget; this excludes browser rendering and is not a browser FPS measurement.

Replay controls sit below the fixed-size canvas. Narrow-screen controls wrap into rows, the result panel can scroll, and camera fitting accounts for the dummy moving above or left of the usual overview. Automated viewport checks cover 320 × 460 and 900 × 700 canvases; these do not replace visual browser checks.

## Development and checks

Use plain JavaScript with two-space indentation and `camelCase` names. No package manager is needed; preserve the pinned local engine and license when sharing the game. Keep physics separate from DOM and rendering code. No formatter, linter, or coverage threshold is configured.

```sh
node --check src/physics.js
node --check src/game.js
node --check src/scores.js
node --check src/character-art.js
node --test tests/*.test.cjs
node scripts/profile.cjs
```

Tests cover 112 push combinations, rigid lengths, mass and inertia, off-center impulses, joint damping and limits, spring recovery, damage, whole-limb contacts, self-collision, continuous collision detection, zero-power gravity, local browser-script loading, repeatability, replay, and UI state transitions. For browser checks, exercise a complete fall, replay, reset, both views, sound, keyboard controls, and narrow/mobile layouts.

Original game reference: [tAAt's Porrasturvat release notes](https://www.pouet.net/prod_nfo.php?which=7090).

The character uses a short neck and arms ending around the upper thigh. This skeleton revision uses replay version `rigid-2.1.0`; older high scores remain visible, but their replays are unavailable because the body geometry changed.

Use **INJURY RINGS ON/OFF** below the stage to hide injury circles and dislocation crosses during play or replay. Impact labels and the damage report remain visible. Injury rings are off by default; the preference is remembered when browser storage is available.

**INJURY TEXT ON/OFF** independently toggles floating injury labels and the impact notice during play and replay. Text is on by default and the preference is saved locally. The body damage report stays available.

**Endless Stairs** generates more steps ahead of the falling character, with no final landing. A steady tracking camera works independently of Motion FX. Rendering keeps steps beyond the camera edges so they scroll out of view without popping away; tread colors stay fixed during descent and replay. Each attempt ends when the character settles or reaches the 120-second recording limit. This chamber has its own high-score board and supports retries and replays.

Every **50 steps passed**, a marked tread and a short humorous announcement celebrate the next depth milestone. Colors gradually shift through sage, blue, lilac and sandstone as the descent continues. The stage shows the current step count, next milestone and best depth for the selected character. Depth records persist locally (`dismount-endless-depth-v1-<character>`); replay and timeline seeking reproduce the depth and colors without setting new records. Milestones are visual markers, not respawn points, and do not affect scores or physics.

Run statistics below the stage show steps passed (ledges in The Shaft), distance travelled, maximum speed, and time airborne. Distance and speed use the whole body's center of mass; airborne time counts ticks with no environment contact. Progress counts steps below and behind the center of mass, so skipped steps count too. Statistics follow replay scrubbing and reset with each attempt.

**FULLSCREEN** expands the stage, statistics, and replay controls together. Use **EXIT FULLSCREEN** or Escape to leave. When native fullscreen is unavailable or rejected, the button opens a full-window game view instead; browser address bars may remain visible. Exit with the same button or Escape.

### Mobile play

The stage adapts to portrait and landscape screens, with closer character framing on narrow or short canvases. Swipe the bottom toolbar horizontally to access all options. Touch controls use larger hit areas, and touch aiming reaches full power with a shorter drag on narrow screens. A second finger cannot replace an active push gesture; resizing or rotating cancels an unfinished gesture safely. Scrolling remains available outside the canvas.

Fullscreen includes the stage, statistics and replay controls, respects display cutouts, and preserves the current round. The full-window fallback restores the page position on exit. Native browser fullscreen and real-device layout/audio still require manual browser testing.

Share a starting chamber with `?chamber=endless`, for example `https://milekz.github.io/dismount/?chamber=endless`. Valid chamber links skip the welcome dialog and open the selected chamber ready for a push. Changing chambers updates the URL without reloading. Supported values: `classic`, `steep`, `long`, `landing`, `uneven`, `shaft`, `endless`, `finalDrop`. Missing or unknown chamber values select Endless Stairs; the welcome screen appears unless the URL contains a valid chamber or character.

Character materials use replay version `rigid-2.3.0`: contact friction and bounce now respect each subject’s fixtures, with an additional stair-edge bonus. Strong pushes to hands or feet use 24 substeps during the push to keep small joints stable; other steps retain 12. Human replays from `rigid-2.2.0` use their historical integration schedule and remain supported. Older scores stay visible; incompatible character replays are disabled. Historical-version replays can be watched or tweaked into a new attempt; exact retry is disabled when the physics version differs.

Chamber links also accept selector numbers: `?chamber=1` (Classic), `2` (Short & steep), `3` (Long & shallow), `4` (Split flight), `5` (Uneven Steps), `6` (The Shaft), `7` (Endless Stairs), and `8` (Final Drop). Padded numbers such as `?chamber=07` work too.


## Compact controls, challenges and ghost

The desktop sidebar matches the stage height. Power and the launch button stay visible while the options above them scroll. **Challenge & sound** expands optional settings, and **Damage summary** expands the small report. Fullscreen’s **SETTINGS** drawer reuses the same controls; closing it preserves the current selection. Escape closes the drawer first in the full-window fallback.

Choose a challenge before a run: **Five-step flight** (five steps passed in one uninterrupted airborne stretch, unavailable in The Shaft), **Gentle push, big trouble** (5,000 points at at most 30% power), or **Frequent flyer** (one accumulated second airborne). Flight progress uses the center-of-mass step count. Challenge feedback does not change scores or physics and is hidden in replay.

**GHOST** overlays the previous completed attempt, aligned by simulation time, during aiming and the next fall. It is off by default, has no collisions or scoring, and clears when changing chamber or subject. Its final pose remains visible if the new attempt lasts longer.

Damage-map heads and torsos follow the selected subject. Robot reports use repairability and mechanical failures; skeletons use reassembly and separated joints; inflatables use air retention and failed seams. These remain fictional game meters.

Sound volume is saved locally. Each display frame prioritizes the strongest pending impact and most severe joint event, with a bounded voice count. Crack variants are recorded with events, so their timbre does not depend on previous attempts. Mute remains independent of volume.

Starting either kind of replay scrolls the page to the stage. Reduced-motion settings disable smooth scrolling; fullscreen keeps its existing view.

## Additional validation

```sh
node --test tests/*.test.cjs
node --expose-gc scripts/profile-recording.cjs raw
node --expose-gc scripts/profile-recording.cjs compact
```

The recording benchmark includes retained JavaScript heap and array buffers. It is a local Node measurement, not a mobile-browser memory guarantee. Idle rendering is capped at 10 FPS; active play retains normal rendering and a deterministic fixed-step solver independent of device speed. Damage-map attributes are updated only when their values change.

Real-browser checks use the WebDriver protocol with no npm dependencies. Start ChromeDriver or SafariDriver separately, then run:

```sh
# ChromeDriver listening on port 4444:
BROWSER=chrome node scripts/browser-check.cjs
MOBILE=1 BROWSER=chrome node scripts/browser-check.cjs
# Safari: enable Develop > Allow Remote Automation and start safaridriver --port 4444.
BROWSER=safari node scripts/browser-check.cjs
```

Set `WEBDRIVER_URL` if the driver uses a different address. The checks cover fullscreen settings, real pointer/touch release, audio-context unlock, saved replay reconstruction and scrolling. They require a desktop environment that permits browser automation and a local HTTP server. Audio quality still needs listening on real speakers/headphones.
