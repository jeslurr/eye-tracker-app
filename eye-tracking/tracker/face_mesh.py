"""MediaPipe Face Mesh wrapper.

refine_landmarks=True is the whole point: it adds landmarks 468-477, the two
iris contours. Without them there is no iris centre and no gaze, only head pose.

Landmark names below match MediaPipe's own FACEMESH_LEFT_*/RIGHT_* constants, so
they can be cross-referenced against the upstream docs. The frame is not
mirrored, so MediaPipe's "right" eye is the one on the image left.
"""
from dataclasses import dataclass

import numpy as np
import cv2
import mediapipe as mp

# Iris contours (refine_landmarks only). First index of each is the fitted centre.
LEFT_IRIS = [473, 474, 475, 476, 477]
RIGHT_IRIS = [468, 469, 470, 471, 472]

# Eye corners and lids, paired with the iris list above.
LEFT_EYE = {"outer": 263, "inner": 362, "top": 386, "bottom": 374}
RIGHT_EYE = {"outer": 33, "inner": 133, "top": 159, "bottom": 145}

# Extra lid points for a more stable eye-aspect-ratio than a single top/bottom pair.
LEFT_EAR_PTS = [(385, 380), (387, 373)]
RIGHT_EAR_PTS = [(160, 144), (158, 153)]

# Six-point subset used for head pose, paired with a canonical 3D face model in
# millimetres. Axes match OpenCV's camera frame -- +x image right, +y image down,
# +z away from the camera -- so a head facing the lens solves to a rotation near
# identity. Using an +y-up model instead would put every Euler angle near 180
# degrees, and the roll correction in gaze.py would then invert the iris offsets.
POSE_LANDMARKS = [1, 152, 33, 263, 61, 291]
POSE_MODEL_POINTS = np.array(
    [
        (0.0, 0.0, 0.0),       # 1   nose tip
        (0.0, 63.6, 12.5),     # 152 chin
        (-43.3, -32.7, 26.0),  # 33  right eye outer corner (image left)
        (43.3, -32.7, 26.0),   # 263 left eye outer corner (image right)
        (-28.9, 28.9, 24.1),   # 61  right mouth corner (image left)
        (28.9, 28.9, 24.1),    # 291 left mouth corner (image right)
    ],
    dtype=np.float64,
)


def _unwrap(deg):
    """Fold a Euler angle into (-90, 90].

    A near-frontal head can decompose to either ~0 or ~180 on any axis depending
    on which of the two equivalent rotations RQDecomp3x3 returns. Left alone,
    that discontinuity makes the pose features flip sign between frames.
    """
    while deg > 90:
        deg -= 180
    while deg <= -90:
        deg += 180
    return deg


@dataclass
class FaceLandmarks:
    """Landmarks in pixel coordinates, plus the head pose solved from them."""

    points: np.ndarray          # (478, 2) float32 pixel coords
    yaw: float                  # degrees, + = turned toward image right
    pitch: float                # degrees, + = chin down
    roll: float                 # degrees, + = head tilted toward image right
    interocular_px: float       # distance between outer eye corners, a depth proxy
    frame_size: tuple           # (w, h)

    def pt(self, idx):
        return self.points[idx]


class FaceMesh:
    def __init__(self):
        self._mesh = mp.solutions.face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self._camera_matrix = None
        self._dist_coeffs = np.zeros((4, 1))

    def _intrinsics(self, w, h):
        if self._camera_matrix is None:
            # No calibration target, so approximate: focal length ~= frame width,
            # principal point at the centre. Good enough because the calibration
            # regression downstream absorbs the residual scale error.
            focal = float(w)
            self._camera_matrix = np.array(
                [[focal, 0, w / 2.0], [0, focal, h / 2.0], [0, 0, 1]], dtype=np.float64
            )
        return self._camera_matrix

    def process(self, frame_bgr):
        """Return FaceLandmarks, or None if no face was found."""
        h, w = frame_bgr.shape[:2]
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        result = self._mesh.process(rgb)
        if not result.multi_face_landmarks:
            return None

        lm = result.multi_face_landmarks[0].landmark
        pts = np.array([(p.x * w, p.y * h) for p in lm], dtype=np.float32)
        if pts.shape[0] < 478:
            # refine_landmarks did not produce iris points; unusable for gaze.
            return None

        yaw, pitch, roll = self._solve_pose(pts, w, h)
        interocular = float(np.linalg.norm(pts[LEFT_EYE["outer"]] - pts[RIGHT_EYE["outer"]]))
        return FaceLandmarks(
            points=pts,
            yaw=yaw,
            pitch=pitch,
            roll=roll,
            interocular_px=interocular,
            frame_size=(w, h),
        )

    def _solve_pose(self, pts, w, h):
        image_points = np.array([pts[i] for i in POSE_LANDMARKS], dtype=np.float64)
        ok, rvec, _tvec = cv2.solvePnP(
            POSE_MODEL_POINTS,
            image_points,
            self._intrinsics(w, h),
            self._dist_coeffs,
            flags=cv2.SOLVEPNP_ITERATIVE,
        )
        if not ok:
            return 0.0, 0.0, 0.0

        rmat, _ = cv2.Rodrigues(rvec)
        # RQDecomp3x3 returns Euler angles in degrees as (pitch, yaw, roll).
        angles = cv2.RQDecomp3x3(rmat)[0]
        pitch, yaw, roll = (_unwrap(float(a)) for a in angles[:3])
        return yaw, pitch, roll

    def close(self):
        self._mesh.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False
