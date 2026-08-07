"""Tunables for the gaze service. Override any of these with env vars."""
import os
from pathlib import Path

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
CALIBRATION_FILE = DATA_DIR / "calibration.json"


def _int(name, default):
    return int(os.environ.get(name, default))


def _float(name, default):
    return float(os.environ.get(name, default))


# --- Camera ---
CAMERA_INDEX = _int("GAZE_CAMERA_INDEX", 0)
FRAME_WIDTH = _int("GAZE_FRAME_WIDTH", 640)
FRAME_HEIGHT = _int("GAZE_FRAME_HEIGHT", 480)
TARGET_FPS = _int("GAZE_FPS", 30)

# --- Server ---
HOST = os.environ.get("GAZE_HOST", "127.0.0.1")
PORT = _int("GAZE_PORT", 8765)

# --- Blink / eye-openness ---
# Openness is measured against a running per-eye baseline rather than absolute
# eye-aspect-ratio thresholds. Absolute values vary enormously with eye shape,
# camera angle and viewing distance -- a fixed threshold that suits one face
# reports another perfectly open eye as half shut, which then gets its samples
# discarded. The ratio of a closed lid to an open one is far more stable.
EAR_CLOSED_FRAC = _float("GAZE_EAR_CLOSED_FRAC", 0.40)
EAR_OPEN_FRAC = _float("GAZE_EAR_OPEN_FRAC", 0.80)
# Hard floor below which the eye is closed no matter what the baseline says.
EAR_ABSOLUTE_FLOOR = _float("GAZE_EAR_FLOOR", 0.04)
# Baseline adaptation: rises quickly toward a new maximum, decays slowly so a
# long blink or a look away doesn't drag it down.
EAR_BASELINE_RISE = _float("GAZE_EAR_RISE", 0.05)
EAR_BASELINE_DECAY = _float("GAZE_EAR_DECAY", 0.9995)

# --- One Euro filter ---
# Lower min_cutoff = more smoothing at rest. Higher beta = less lag on saccades.
#
# beta is in Hz per (px/s) and is far more sensitive than it looks. Webcam noise
# alone produces a few hundred px/s of apparent speed, so anything above ~0.05
# lets the noise itself raise the cutoff and the filter stops filtering. These
# values measure at ~4px std while fixating with a 2-frame (67ms) response to a
# saccade, inside the 100ms gaze-to-action budget.
FILTER_MIN_CUTOFF = _float("GAZE_MIN_CUTOFF", 1.0)
FILTER_BETA = _float("GAZE_BETA", 0.005)
FILTER_D_CUTOFF = _float("GAZE_D_CUTOFF", 1.0)

# --- Calibration ---
# Samples collected per calibration point before it is accepted.
SAMPLES_PER_POINT = _int("GAZE_SAMPLES_PER_POINT", 30)
# Samples below this confidence are dropped from the fit rather than poisoning
# it. Lowering this speeds up calibration in poor light at the cost of accuracy.
MIN_SAMPLE_CONFIDENCE = _float("GAZE_MIN_SAMPLE_CONF", 0.5)
# Fraction of each point's samples discarded as settling time.
POINT_WARMUP_FRAC = _float("GAZE_POINT_WARMUP", 0.3)
# Ridge regularisation strength on standardised features.
RIDGE_LAMBDA = _float("GAZE_RIDGE_LAMBDA", 1.0)
