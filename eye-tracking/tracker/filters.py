"""One Euro filter.

A fixed low-pass filter forces a choice between jitter at rest and lag during
saccades. One Euro adapts its cutoff to the signal's own speed: heavy smoothing
while the eye fixates, almost none while it moves. That matters here because
fixation dispersion is exactly what the behaviour engine measures downstream --
over-smoothing would manufacture fixations that never happened.

Casiez, Roussel & Vogel, CHI 2012.
"""
import math

from config import FILTER_MIN_CUTOFF, FILTER_BETA, FILTER_D_CUTOFF


def _alpha(cutoff, dt):
    tau = 1.0 / (2.0 * math.pi * cutoff)
    return 1.0 / (1.0 + tau / dt)


class _LowPass:
    def __init__(self):
        self.value = None

    def __call__(self, x, alpha):
        if self.value is None:
            self.value = x
        else:
            self.value = alpha * x + (1.0 - alpha) * self.value
        return self.value


class OneEuroFilter1D:
    def __init__(self, min_cutoff=FILTER_MIN_CUTOFF, beta=FILTER_BETA, d_cutoff=FILTER_D_CUTOFF):
        self.min_cutoff = min_cutoff
        self.beta = beta
        self.d_cutoff = d_cutoff
        self._x = _LowPass()
        self._dx = _LowPass()
        self._prev_x = None
        self._prev_t = None

    def reset(self):
        self._x = _LowPass()
        self._dx = _LowPass()
        self._prev_x = None
        self._prev_t = None

    def __call__(self, x, t):
        if self._prev_t is None:
            dt = 1.0 / 30.0
        else:
            dt = t - self._prev_t
            # Clamp: a stalled camera or a resumed tab must not produce a dt
            # that makes alpha ~= 1 and defeats the filter entirely.
            dt = min(max(dt, 1e-3), 0.2)
        self._prev_t = t

        rate = 0.0 if self._prev_x is None else (x - self._prev_x) / dt
        self._prev_x = x
        edx = self._dx(rate, _alpha(self.d_cutoff, dt))
        cutoff = self.min_cutoff + self.beta * abs(edx)
        return self._x(x, _alpha(cutoff, dt))


class OneEuroFilter2D:
    def __init__(self, **kwargs):
        self._fx = OneEuroFilter1D(**kwargs)
        self._fy = OneEuroFilter1D(**kwargs)

    def reset(self):
        self._fx.reset()
        self._fy.reset()

    def __call__(self, x, y, t):
        return self._fx(x, t), self._fy(y, t)
