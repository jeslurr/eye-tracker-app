import sys

import numpy as np

from config import CALIBRATION_FILE
from tracker.calibration import Calibrator, CalibrationError
from tracker.filters import OneEuroFilter2D
from tracker.gaze import GazeFeatures

VIEWPORT = (1280, 720)
POINTS = [(x, y) for y in (0.1, 0.5, 0.9) for x in (0.1, 0.5, 0.9)]

# Half-angle the screen subtends from a normal seating distance.
SCREEN_HALF_ANGLE_X = 20.0  # degrees
SCREEN_HALF_ANGLE_Y = 12.0

# Iris displacement per degree of eye rotation, in eye-width units:
# eyeball radius ~12mm over a ~30mm palpebral fissure gives 0.4 * sin(theta).
IRIS_PER_RADIAN = 0.4

# Heads follow gaze. A person looking at a dot 20 degrees off-centre turns
# roughly a third of the way there rather than moving the eyes alone.
HEAD_FOLLOW = 0.35


def target_to_angles(target, viewport):
    w, h = viewport
    nx = (target[0] / w) * 2 - 1  # -1..1
    ny = (target[1] / h) * 2 - 1
    return nx * SCREEN_HALF_ANGLE_X, ny * SCREEN_HALF_ANGLE_Y


def synth_features(target, viewport, rng, head_yaw=None, head_pitch=None):
    """Invent plausible iris offsets for a gaze at `target`.

    The key constraint is that a degree of eye rotation looks the same to the
    camera whether it came from the target moving or the head turning -- the
    iris only knows its own angle. Getting that wrong would let the fit pass a
    head-compensation test it would fail on real data.

    Leaving head_yaw/head_pitch as None models a relaxed user whose head partly
    follows the target, which is what actually happens during calibration.
    """
    gaze_x, gaze_y = target_to_angles(target, viewport)
    if head_yaw is None:
        # Systematic following plus independent drift. The drift is what makes
        # the yaw coefficient identifiable; without it yaw is collinear with
        # gaze and no amount of data would separate them.
        head_yaw = HEAD_FOLLOW * gaze_x + rng.normal(0, 3.0)
    if head_pitch is None:
        head_pitch = HEAD_FOLLOW * gaze_y + rng.normal(0, 2.0)

    # The eye makes up whatever the head did not.
    eye_x = np.radians(gaze_x - head_yaw)
    eye_y = np.radians(gaze_y - head_pitch)
    base_x = IRIS_PER_RADIAN * np.sin(eye_x)
    base_y = IRIS_PER_RADIAN * np.sin(eye_y)

    def noise():
        return rng.normal(0, 0.004)

    return GazeFeatures(
        left_x=base_x + noise(),
        left_y=base_y + noise(),
        right_x=base_x + 0.008 + noise(),  # slight per-eye asymmetry
        right_y=base_y + noise(),
        yaw=head_yaw + rng.normal(0, 0.4),
        pitch=head_pitch + rng.normal(0, 0.4),
        roll=rng.normal(0, 0.3),
        interocular_px=118.0 + rng.normal(0, 0.8),
        openness=1.0,
        confidence=0.95,
    )


def check(label, ok, detail=""):
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label}{(' -- ' + detail) if detail else ''}")
    return ok


def main():
    rng = np.random.default_rng(7)
    w, h = VIEWPORT
    ok = True

    print("Calibration fit")
    cal = Calibrator()
    cal.begin()
    for fx, fy in POINTS:
        target = (fx * w, fy * h)
        cal.begin_point(*target)
        while cal.collecting:
            cal.feed(synth_features(target, VIEWPORT, rng))

    try:
        meta = cal.fit(viewport={"w": w, "h": h, "dpr": 1})
    except CalibrationError as exc:
        print(f"  [FAIL] fit raised: {exc}")
        return 1

    ok &= check("fit produced a model", cal.is_fitted)
    ok &= check(
        "cross-validated error is plausible",
        meta["error_px"] < 60,
        f"{meta['error_px']}px over {meta['n_samples']} samples",
    )

    print("Held-out accuracy")
    errors = []
    for _ in range(200):
        target = (rng.uniform(0.05, 0.95) * w, rng.uniform(0.05, 0.95) * h)
        pred = cal.predict(synth_features(target, VIEWPORT, rng))
        errors.append(np.hypot(pred[0] - target[0], pred[1] - target[1]))
    mean_err = float(np.mean(errors))
    ok &= check("random on-screen targets", mean_err < 80, f"mean {mean_err:.1f}px")

    print("Head-movement robustness")
    # A fixed head pose well outside anything seen during calibration. This is
    # the case that separates a real head-compensating fit from one that merely
    # memorised iris position.
    moved = []
    for _ in range(200):
        target = (rng.uniform(0.05, 0.95) * w, rng.uniform(0.05, 0.95) * h)
        f = synth_features(target, VIEWPORT, rng, head_yaw=8.0, head_pitch=-5.0)
        pred = cal.predict(f)
        moved.append(np.hypot(pred[0] - target[0], pred[1] - target[1]))
    moved_err = float(np.mean(moved))
    ok &= check(
        "head turned 8deg after calibration",
        moved_err < mean_err * 2.5,
        f"mean {moved_err:.1f}px vs {mean_err:.1f}px at rest",
    )

    # The same fit with no head variance in its training data must NOT be
    # trusted to compensate -- if this ever starts passing, the generator has
    # stopped modelling the physics and the test above is worthless.
    rigid = Calibrator()
    rigid.begin()
    for fx, fy in POINTS:
        target = (fx * w, fy * h)
        rigid.begin_point(*target)
        while rigid.collecting:
            rigid.feed(synth_features(target, VIEWPORT, rng, head_yaw=0.0, head_pitch=0.0))
    rigid.fit()
    rigid_err = float(
        np.mean(
            [
                np.hypot(*(np.subtract(rigid.predict(
                    synth_features(t, VIEWPORT, rng, head_yaw=8.0, head_pitch=-5.0)), t)))
                for t in [(rng.uniform(0.05, 0.95) * w, rng.uniform(0.05, 0.95) * h)
                          for _ in range(200)]
            ]
        )
    )
    ok &= check(
        "rigid-head calibration cannot compensate (control)",
        rigid_err > moved_err * 1.5,
        f"mean {rigid_err:.1f}px -- head pose is unidentifiable without variance",
    )

    print("Persistence round-trip")
    tmp = CALIBRATION_FILE.parent / "calibration.selftest.json"
    cal.save(tmp)
    probe_target = (0.42 * w, 0.63 * h)
    probe = synth_features(probe_target, VIEWPORT, rng)
    before = cal.predict(probe)

    restored = Calibrator()
    loaded = restored.load(tmp)
    ok &= check("saved calibration loads", loaded is not None)
    if loaded is not None:
        after = restored.predict(probe)
        ok &= check(
            "prediction identical after reload",
            np.allclose(before, after, atol=1e-6),
            f"{before} vs {after}",
        )
    tmp.unlink(missing_ok=True)

    print("Rejections")
    blink = synth_features((640, 360), VIEWPORT, rng)
    blink.confidence = 0.1
    cal2 = Calibrator()
    cal2.begin()
    cal2.begin_point(640, 360)
    collected, _, reason = cal2.feed(blink)
    ok &= check("low-confidence samples are dropped", collected == 0)
    # A dropped sample must say why -- silence here is what froze the UI.
    ok &= check("dropped samples report a reason", reason is not None, str(reason))
    no_face = cal2.feed(None)
    ok &= check("a lost face reports a reason too", no_face[2] == "no_face", str(no_face))

    cal3 = Calibrator()
    cal3.begin()
    for fx, fy in POINTS[:3]:
        cal3.begin_point(fx * w, fy * h)
        while cal3.collecting:
            cal3.feed(synth_features((fx * w, fy * h), VIEWPORT, rng))
    try:
        cal3.fit()
        ok &= check("too few points is rejected", False)
    except CalibrationError:
        ok &= check("too few points is rejected", True)

    print("One Euro filter")
    f = OneEuroFilter2D()
    t = 0.0
    out = []
    for i in range(120):
        t += 1 / 30
        # Steady target with noise, then a step change halfway through.
        target = 300 if i < 60 else 700
        out.append(f(target + rng.normal(0, 12), 400, t))
    rest = np.std([p[0] for p in out[30:58]])
    settled = abs(out[-1][0] - 700)
    # Input noise is std 12px; anything close to that means beta is high enough
    # that the noise drives the cutoff and no filtering is happening.
    ok &= check("smooths jitter at rest", rest < 6, f"std {rest:.1f}px from 12px input noise")
    ok &= check("keeps up with a saccade", settled < 15, f"{settled:.1f}px from target")
    xs = [p[0] for p in out[60:]]
    latency = next((j for j, v in enumerate(xs) if abs(v - 700) < 30), 99)
    ok &= check(
        "saccade latency within the 100ms budget",
        latency <= 3,
        f"{latency} frames (~{latency * 33}ms)",
    )

    print()
    print("ALL PASS" if ok else "FAILURES ABOVE")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
