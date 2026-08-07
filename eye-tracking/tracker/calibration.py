"""Per-user calibration: gaze features -> viewport pixels.

Ridge regression on a small quadratic expansion of the feature vector. The
quadratic terms matter because the eye rotates in a sphere while the screen is
flat, so the iris-offset-to-pixel relationship is not linear toward the edges.
The yaw/pitch cross terms are what let the child move their head between
calibration and play without the mapping collapsing.

Targets are *viewport* coordinates supplied by the browser, not desktop screen
coordinates. That is deliberate: the service has no idea where the browser
window sits, and calibrating directly into the coordinate space the frontend
hit-tests in removes the conversion entirely. The cost is that moving or
resizing the window invalidates the calibration, which fit_meta records.
"""
import json
import time

import numpy as np

from config import (
    CALIBRATION_FILE,
    DATA_DIR,
    MIN_SAMPLE_CONFIDENCE,
    RIDGE_LAMBDA,
    SAMPLES_PER_POINT,
    POINT_WARMUP_FRAC,
)
from .gaze import FEATURE_VERSION

MODEL_VERSION = 1


def _design_row(v):
    """Quadratic expansion of a raw feature vector. Order is part of the
    on-disk format -- bump MODEL_VERSION if it changes."""
    lx, ly, rx, ry, yaw, pitch, _roll, iod = v
    ex = (lx + rx) / 2.0
    ey = (ly + ry) / 2.0
    return np.array(
        [
            ex,
            ey,
            ex * ex,
            ey * ey,
            ex * ey,
            yaw,
            pitch,
            ex * yaw,
            ey * pitch,
            ex * pitch,
            ey * yaw,
            lx - rx,   # inter-eye disagreement, tracks convergence depth
            iod,       # head distance proxy
        ],
        dtype=np.float64,
    )


N_DESIGN = 13


def _fit_ridge(X, Y, lam):
    """Standardised ridge with an unregularised intercept."""
    mu = X.mean(axis=0)
    sigma = X.std(axis=0)
    sigma[sigma < 1e-9] = 1.0
    Xs = (X - mu) / sigma

    y_mean = Y.mean(axis=0)
    Yc = Y - y_mean

    A = Xs.T @ Xs + lam * np.eye(Xs.shape[1])
    W = np.linalg.solve(A, Xs.T @ Yc)
    return {"mu": mu, "sigma": sigma, "W": W, "y_mean": y_mean}


def _apply(model, X):
    Xs = (X - model["mu"]) / model["sigma"]
    return Xs @ model["W"] + model["y_mean"]


class CalibrationError(RuntimeError):
    pass


class Calibrator:
    def __init__(self, lam=RIDGE_LAMBDA, samples_per_point=SAMPLES_PER_POINT):
        self.lam = lam
        self.samples_per_point = samples_per_point
        self._model = None
        self._meta = {}
        # Collection state
        self._points = []          # list of (target_xy, [raw feature vectors])
        self._active = None        # index into _points, or None

    # --- collection -------------------------------------------------------

    def begin(self):
        """Discard any in-progress collection and start fresh."""
        self._points = []
        self._active = None

    def begin_point(self, x, y):
        self._points.append(((float(x), float(y)), []))
        self._active = len(self._points) - 1
        return self._active

    def feed(self, features):
        """Add a sample to the active calibration point.

        Returns (collected, needed, reason), or None when no point is active.
        `reason` is None when the sample was accepted, otherwise why it wasn't.
        The caller must forward that reason to the UI: a rejected sample looks
        identical to a frozen program from the user's side, and a calibration
        dot that never fills with no explanation is unescapable.

        Low-confidence samples (blinks, extreme head turns) are dropped rather
        than poisoning the fit -- the child blinking on a dot is normal.
        """
        if self._active is None:
            return None
        collected = len(self._points[self._active][1])
        if features is None:
            return collected, self.samples_per_point, "no_face"
        if features.confidence < MIN_SAMPLE_CONFIDENCE:
            reason = "eyes_closed" if features.openness < 0.5 else "head_turned"
            return collected, self.samples_per_point, reason

        bucket = self._points[self._active][1]
        bucket.append(features.as_vector())
        if len(bucket) >= self.samples_per_point:
            self._active = None
        return len(bucket), self.samples_per_point, None

    def cancel_point(self):
        if self._active is not None:
            self._points.pop(self._active)
            self._active = None

    @property
    def collecting(self):
        return self._active is not None

    @property
    def point_count(self):
        return len(self._points)

    # --- fitting ----------------------------------------------------------

    def _usable_points(self):
        """Drop each point's warm-up samples -- the eye is still travelling
        toward the dot for the first fraction of the dwell."""
        out = []
        for target, raws in self._points:
            if not raws:
                continue
            skip = int(len(raws) * POINT_WARMUP_FRAC)
            kept = raws[skip:] if len(raws) - skip >= 3 else raws
            if kept:
                out.append((target, [np.asarray(r, dtype=np.float64) for r in kept]))
        return out

    def fit(self, viewport=None):
        points = self._usable_points()
        if len(points) < 5:
            raise CalibrationError(
                f"Need at least 5 calibration points, got {len(points)}."
            )

        X, Y = [], []
        for target, raws in points:
            for raw in raws:
                X.append(_design_row(raw))
                Y.append(target)
        X = np.asarray(X)
        Y = np.asarray(Y)

        model = _fit_ridge(X, Y, self.lam)
        train_err = float(np.mean(np.linalg.norm(_apply(model, X) - Y, axis=1)))
        cv_err = self._leave_one_point_out(points)

        self._model = model
        self._meta = {
            "model_version": MODEL_VERSION,
            "feature_version": FEATURE_VERSION,
            "fitted_at": int(time.time() * 1000),
            "n_points": len(points),
            "n_samples": int(X.shape[0]),
            "train_error_px": round(train_err, 1),
            "error_px": round(cv_err, 1) if cv_err is not None else round(train_err, 1),
            "viewport": viewport,
        }
        self._points = []
        self._active = None
        return dict(self._meta)

    def _leave_one_point_out(self, points):
        """Hold out one calibration dot at a time and predict it from the rest.

        Training error on a fit this flexible is meaningless -- it would report
        ~10px and mislead. This is the number worth showing a user.
        """
        if len(points) < 6:
            return None
        errors = []
        for held in range(len(points)):
            X, Y = [], []
            for i, (target, raws) in enumerate(points):
                if i == held:
                    continue
                for raw in raws:
                    X.append(_design_row(raw))
                    Y.append(target)
            try:
                model = _fit_ridge(np.asarray(X), np.asarray(Y), self.lam)
            except np.linalg.LinAlgError:
                return None
            target, raws = points[held]
            Xh = np.asarray([_design_row(r) for r in raws])
            pred = _apply(model, Xh)
            errors.append(float(np.mean(np.linalg.norm(pred - np.asarray(target), axis=1))))
        return float(np.mean(errors))

    # --- prediction -------------------------------------------------------

    @property
    def is_fitted(self):
        return self._model is not None

    @property
    def meta(self):
        return dict(self._meta)

    def predict(self, features):
        if self._model is None or features is None:
            return None
        row = _design_row(features.as_vector())[None, :]
        x, y = _apply(self._model, row)[0]
        return float(x), float(y)

    # --- persistence ------------------------------------------------------

    def save(self, path=CALIBRATION_FILE):
        if self._model is None:
            raise CalibrationError("Nothing to save -- fit() first.")
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        payload = {
            "meta": self._meta,
            "model": {
                "mu": self._model["mu"].tolist(),
                "sigma": self._model["sigma"].tolist(),
                "W": self._model["W"].tolist(),
                "y_mean": self._model["y_mean"].tolist(),
            },
        }
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return path

    def load(self, path=CALIBRATION_FILE):
        """Restore a saved calibration. Returns meta, or None if absent/stale."""
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            meta = payload["meta"]
            if meta.get("model_version") != MODEL_VERSION:
                return None
            if meta.get("feature_version") != FEATURE_VERSION:
                return None
            m = payload["model"]
            W = np.asarray(m["W"], dtype=np.float64)
            if W.shape != (N_DESIGN, 2):
                return None
            self._model = {
                "mu": np.asarray(m["mu"], dtype=np.float64),
                "sigma": np.asarray(m["sigma"], dtype=np.float64),
                "W": W,
                "y_mean": np.asarray(m["y_mean"], dtype=np.float64),
            }
            self._meta = meta
            return dict(meta)
        except (json.JSONDecodeError, KeyError, ValueError):
            return None

    def clear(self, path=CALIBRATION_FILE):
        self._model = None
        self._meta = {}
        self._points = []
        self._active = None
        if path.exists():
            path.unlink()
