"""Turn face landmarks into a gaze feature vector.

Pure geometric ray-casting needs camera intrinsics we do not have and eyeball
radii that vary per person, so it drifts badly on a laptop webcam. Instead we
extract features that *correlate* with gaze direction and let the per-user
calibration regression in calibration.py learn the mapping to screen pixels.

The features that matter:
  - iris offset within each eye socket, roll-corrected and scale-normalised
  - head yaw/pitch, so the regression can compensate for head movement
  - eye openness, used for confidence rather than as a predictor
"""
import math
from dataclasses import dataclass

import numpy as np

from config import EAR_ABSOLUTE_FLOOR, EAR_CLOSED_FRAC, EAR_OPEN_FRAC, EAR_BASELINE_RISE, EAR_BASELINE_DECAY
from .face_mesh import (
    FaceLandmarks,
    LEFT_EYE,
    RIGHT_EYE,
    LEFT_IRIS,
    RIGHT_IRIS,
    LEFT_EAR_PTS,
    RIGHT_EAR_PTS,
)


@dataclass
class GazeFeatures:
    left_x: float
    left_y: float
    right_x: float
    right_y: float
    yaw: float
    pitch: float
    roll: float
    interocular_px: float
    openness: float     # 0..1, from eye aspect ratio
    confidence: float   # 0..1

    def as_vector(self):
        """Raw feature vector consumed by the calibration model.

        Order is part of the on-disk calibration format. Appending is safe;
        reordering or removing requires bumping FEATURE_VERSION.
        """
        return np.array(
            [
                self.left_x,
                self.left_y,
                self.right_x,
                self.right_y,
                self.yaw,
                self.pitch,
                self.roll,
                self.interocular_px,
            ],
            dtype=np.float64,
        )


FEATURE_VERSION = 1
FEATURE_NAMES = ["left_x", "left_y", "right_x", "right_y", "yaw", "pitch", "roll", "iod"]


def _eye_aspect_ratio(pts, pairs, width):
    if width <= 1e-6:
        return 0.0
    heights = [float(np.linalg.norm(pts[a] - pts[b])) for a, b in pairs]
    return float(np.mean(heights) / width)


def _iris_offset(pts, eye, iris_ids, roll_deg):
    """Iris centre relative to the eye socket centre, in eye-width units.

    Normalising by eye width (not height) for both axes keeps the vertical
    signal on the same scale as the horizontal one; the socket is far shorter
    than it is wide, so dividing by height would blow up vertical noise.
    """
    outer = pts[eye["outer"]]
    inner = pts[eye["inner"]]
    top = pts[eye["top"]]
    bottom = pts[eye["bottom"]]

    width = float(np.linalg.norm(outer - inner))
    if width <= 1e-6:
        return 0.0, 0.0, 0.0

    centre = np.array(
        [(outer[0] + inner[0]) / 2.0, (top[1] + bottom[1]) / 2.0], dtype=np.float64
    )
    iris = pts[iris_ids].astype(np.float64).mean(axis=0)
    dx, dy = (iris - centre) / width

    # Undo head roll so a tilted head does not leak into the vertical signal.
    r = math.radians(-roll_deg)
    cos_r, sin_r = math.cos(r), math.sin(r)
    return dx * cos_r - dy * sin_r, dx * sin_r + dy * cos_r, width


class _OpennessTracker:
    """Per-eye eye-aspect-ratio baseline, adapted online.

    Rises quickly toward a new maximum so it settles within a second or two of
    the user appearing, and decays very slowly so a long blink or a glance away
    doesn't drag the reference down and make an open eye look closed.
    """

    def __init__(self):
        self.baseline = None

    def update(self, ear):
        if self.baseline is None:
            self.baseline = max(ear, EAR_ABSOLUTE_FLOOR)
        elif ear > self.baseline:
            self.baseline += EAR_BASELINE_RISE * (ear - self.baseline)
        else:
            self.baseline = max(self.baseline * EAR_BASELINE_DECAY, EAR_ABSOLUTE_FLOOR)
        return self.baseline

    def openness(self, ear):
        baseline = self.update(ear)
        if ear < EAR_ABSOLUTE_FLOOR:
            return 0.0
        low = EAR_CLOSED_FRAC * baseline
        high = EAR_OPEN_FRAC * baseline
        return float(np.clip((ear - low) / max(high - low, 1e-6), 0.0, 1.0))


class FeatureExtractor:
    """Stateful because eye openness is judged relative to this user's own
    baseline. Construct one per session."""

    def __init__(self):
        self._left = _OpennessTracker()
        self._right = _OpennessTracker()

    def reset(self):
        self._left = _OpennessTracker()
        self._right = _OpennessTracker()

    def __call__(self, face: FaceLandmarks):
        """Return GazeFeatures for a detected face, or None if unusable."""
        if face is None:
            return None
        pts = face.points

        lx, ly, l_width = _iris_offset(pts, LEFT_EYE, LEFT_IRIS, face.roll)
        rx, ry, r_width = _iris_offset(pts, RIGHT_EYE, RIGHT_IRIS, face.roll)
        if l_width <= 1e-6 or r_width <= 1e-6:
            return None

        l_open = self._left.openness(_eye_aspect_ratio(pts, LEFT_EAR_PTS, l_width))
        r_open = self._right.openness(_eye_aspect_ratio(pts, RIGHT_EAR_PTS, r_width))
        # Take the better eye: one lid drooping or occluded shouldn't discard a
        # sample the other eye can still support.
        openness = float(max(l_open, r_open))

        # Extreme head angles put the far iris out of view and the mapping
        # degrades fast, so fold that into confidence rather than silently
        # reporting a position the model was never calibrated for.
        pose_penalty = float(np.clip(1.0 - (abs(face.yaw) / 45.0) ** 2, 0.0, 1.0))
        confidence = float(np.clip(openness * pose_penalty, 0.0, 1.0))

        return GazeFeatures(
            left_x=lx,
            left_y=ly,
            right_x=rx,
            right_y=ry,
            yaw=face.yaw,
            pitch=face.pitch,
            roll=face.roll,
            interocular_px=face.interocular_px,
            openness=openness,
            confidence=confidence,
        )


def extract_features(face: FaceLandmarks, extractor=None):
    """One-shot convenience wrapper. Prefer a long-lived FeatureExtractor --
    a fresh one has no openness baseline and under-reports the first frames."""
    return (extractor or FeatureExtractor())(face)
