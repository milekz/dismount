# Body physics calibration

The current replay version is `rigid-3.1.0`, adding progress scoring without changing
the `rigid-3.0.0` body physics. All five subjects use distinct segment masses,
centers of mass (COM), rotational inertia, damping and neck compliance. This is a
passive 2D ragdoll with stylized collision shapes, not a validated biomechanics or
injury simulator.

## Scale and mass

Gravity is 9.81 m/s². At 70 drawing units per meter, the initial 122.5-unit
collision envelope is 1.75 m tall. Artwork and chamber coordinates are unchanged;
the stair rises represent oversized stunt obstacles. Head size and segment
lengths remain stylized rather than matching an anthropometric scan.

| Subject | Total mass | Distribution |
| --- | ---: | --- |
| Human | 73 kg | Published human segment mass fractions |
| Robot | 110 kg | Chassis and pelvis carry most weight; limb COMs favor proximal motors |
| Knight | 96 kg | Human body plus 23 kg of separately distributed armor |
| Skeleton | 10 kg | Designed bone-like distribution, with relatively heavy skull and rib cage |
| Inflatable | 3 kg | Skin mass proportional to capsule surface area |

Human ratios come from the male reference in [de Leva (1996), Table 4,
“Adjustments to Zatsiorsky–Seluyanov's segment inertia parameters”](https://doi.org/10.1016/0021-9290(95)00178-6).
These population averages describe a reference subject, not every human.
The other subjects' masses and materials are explicit game design estimates.

## Segment COM and inertia

`src/body-profiles.js` stores the human mass fraction, proximal COM fraction and
transverse radius of gyration for each segment. Rotation in the sagittal plane
uses the transverse axis. Inertia about the segment COM is `I = mass × (k × length)²`.

Endpoint mappings matter:

- Upper arms and thighs use joint-to-joint lengths; shins use the knee–ankle
  variant of the source table.
- Hands use wrist–fingertip data, extending to the fingertip cap. Feet use the
  full heel–toe envelope.
- The three torso bodies approximate the cervicale–xyphion,
  xyphion–omphalion and omphalion–mid-hip segments.
- The source's 6.94% head mass is split into 6.14% head and 0.80% cervical link.
  The circular head maps vertex–jaw ratios onto its diameter. This split and
  geometric mapping are approximations.

Robot inertia uses a uniform capsule lamina. Skeleton and inflatable segments
use a thin capsule outline; these are 2D material approximations. Their inertia
is calculated without double-counting the overlapping collision fixtures.
Armor is added as shell components: its COM and inertia combine with the human
segment using the parallel-axis theorem.

Planck requires inertia **about the body's local origin**. We supply
`I_origin = I_COM + mass × |localCOM|²`; forces and velocities then act around
the true COM. See the pinned [Planck body documentation](https://app.unpkg.com/planck@1.5.0/files/docs/pages/body.md).
The whole-body COM is the mass-weighted average of those world-space centers.

## Forces, joints and limits

Pushes deliver `totalMass × 4.6 × power` N·s over 0.2 seconds at the selected body
point. Power is normalized to subject mass for comparable playability: it is
not the same force in newtons for every subject. An off-center push produces
torque. Zero power applies no impulse.

Joint damping depends on the pair's effective inertia about its hinge and a
material-specific decay time. Bounded zero-speed motors dissipate motion;
there is no active balancing or muscle control. Neck spring stiffness and
damping derive from effective head/trunk mass, frequency and damping ratio.
Healthy extension limits are 12 mm for Human/Knight, 3 mm for Robot, 6 mm for
Skeleton and 60 mm for Inflatable. Injury widens those limits while retaining
attachment. These values and injury thresholds are game constraints, not
clinical tolerances. Air resistance is a simplified velocity damping model.

Anatomical angular stops, collision detection and deterministic substeps remain
in use. Overlapping structural neighbors, including head/chest at the collar,
do not collide with each other; distant segments still self-collide.
Edge bonuses, damage, recovery meters and scoring remain arcade systems.
Tests verify mass properties, impulse response, momentum, gravity, spring
recovery, joint limits and repeatability; they do not establish real-world
biomechanical accuracy.

## Replays and records

The optional physics view observes solver impulses without changing the simulation.
It sums environment normal and friction impulses per body over a 120 Hz tick,
then divides by the elapsed simulation time to show average force in newtons.
Up to four strongest body resultants are retained, along with the mass-weighted
COM and velocity. Internal body contacts are excluded. These force values are
separate from the arcade `impact.force` severity used for scoring and sound.
Compact recordings retain telemetry for exact timeline seeking; the display
starts disabled and has no effect on replay versioning or rankings.

`src/physics-legacy.js` freezes the published 2.3 solver for all subjects and the
2.2 Human schedule. Both worker and main-thread replay reconstruction dispatch
by recipe version. Regression hashes protect historical trajectories.

Version 3.1 adds 10 points per newly passed stair or shaft ledge, capped at
`floor(impactScore / 5)`. The furthest center-of-mass step count prevents repeat
bonuses; raw distance adds none. Snapshots keep the total in `score`; summed
`damage` groups retain the impact subtotal. Recovery meters use damage only.
Version 3.0 recipes disable this bonus and retain their original output for all
five subjects. Compact recordings preserve the breakdown while seeking.

New scores use `dismount-scoreboard-v4` with chamber/character suffixes.
The old v3 and v2 boards remain untouched under **Previous records & replays**.
Personal bests use `dismount-anatomy-best-v4`; endless depth records stay at
`dismount-endless-depth-v2-<character>` because physics and depth are unchanged.
Old scores do not compete with the new rules. Historical runs can be watched or tweaked;
exact retry remains available only for the current version.
