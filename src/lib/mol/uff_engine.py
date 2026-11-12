"""Halden geometry relaxer.

Pure Python (stdlib only) so the same file runs in CPython and in the
browser under Pyodide. The potential is a Universal Force Field-style
bond stretch, harmonic angle bend, and Lennard-Jones dispersion /
repulsion, plus a planarity penalty on sp2 centers.

Frozen atoms are omitted from the coordinate update. They still exert
forces on atoms that are free to move.

References for the functional form:
  Rappe, Casewit, Colwell, Goddard, Skiff, J. Am. Chem. Soc. 1992, 114, 10024.
"""

from __future__ import annotations

import json
import math

# r bond radius (A), theta default angle (deg), Z effective charge,
# D well depth (kcal/mol), x van der Waals distance (A).
_PARAMS = {
    "H": (0.354, 180.00, 0.712, 0.044, 2.886),
    "C": (0.757, 109.47, 1.912, 0.105, 3.851),
    "N": (0.700, 106.70, 2.544, 0.069, 3.660),
    "O": (0.658, 104.51, 2.300, 0.060, 3.500),
    "F": (0.611, 180.00, 1.735, 0.050, 3.364),
    "P": (1.117, 93.80, 2.863, 0.305, 4.147),
    "S": (1.064, 92.10, 2.703, 0.274, 4.035),
    "Cl": (1.044, 180.00, 2.383, 0.227, 3.947),
    "Br": (1.260, 180.00, 2.219, 0.251, 4.189),
    "I": (1.424, 180.00, 2.244, 0.339, 4.500),
    "Si": (1.117, 109.47, 1.682, 0.402, 4.295),
    "Mo": (1.473, 90.00, 3.052, 0.056, 3.052),
}
_DEFAULT = (1.050, 109.47, 1.500, 0.100, 3.800)


def _par(el):
    return _PARAMS.get(el, _DEFAULT)


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _len(a):
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def _norm(a):
    length = _len(a)
    if length < 1e-12:
        return (0.0, 0.0, 0.0)
    return (a[0] / length, a[1] / length, a[2] / length)


class Session:
    """One relaxation. `burst` advances a handful of steps and can be
    called repeatedly so the UI can redraw between them."""

    def __init__(self, payload):
        self.el = list(payload["elements"])
        self.pos = [list(map(float, p)) for p in payload["positions"]]
        self.bonds = [(int(b[0]), int(b[1]), float(b[2])) for b in payload["bonds"]]
        self.frozen = set(int(i) for i in payload.get("frozen", []))
        self.n = len(self.el)
        self.step = 0
        self.step_size = 0.0015
        self.best_e = None
        self.best_pos = [p[:] for p in self.pos]
        requested = int(payload.get("maxSteps", 0))
        # Small molecules (the drug) get a tighter, fuller potential.
        # Crystals and proteins use the analytical potential with a cap
        # so a click stays interactive inside Pyodide.
        self.full = self.n <= 80
        self.max_steps = requested or (100 if self.full else 36)
        self.tol = 0.08 if self.full else 0.25
        self._prepare()

    def _prepare(self):
        n = self.n
        adj = [[] for _ in range(n)]
        for i, j, order in self.bonds:
            if i == j:
                continue
            adj[i].append((j, order))
            adj[j].append((i, order))
        self.adj = adj

        hyb = []
        for i in range(n):
            orders = [o for _, o in adj[i]]
            hyb.append(_hybridization(self.el[i], orders))
        self.hyb = hyb

        bond_terms = []
        for i, j, order in self.bonds:
            if i == j:
                continue
            a, b = (i, j) if i < j else (j, i)
            r0, k = _bond_r0_k(self.el[a], self.el[b], order)
            bond_terms.append((a, b, r0, k))
        # unique
        seen = set()
        uniq = []
        for term in bond_terms:
            key = (term[0], term[1])
            if key in seen:
                continue
            seen.add(key)
            uniq.append(term)
        self.bond_terms = uniq

        angle_terms = []
        for j in range(n):
            nbs = adj[j]
            if len(nbs) < 2:
                continue
            theta0 = _theta0(self.el[j], hyb[j])
            pj = _par(self.el[j])
            for a in range(len(nbs)):
                for b in range(a + 1, len(nbs)):
                    i = nbs[a][0]
                    k = nbs[b][0]
                    # scale angle force constant by the two outer atoms
                    zi = _par(self.el[i])[2]
                    zk = _par(self.el[k])[2]
                    ka = 85.0 * math.sqrt(max(zi * zk, 0.2)) / 1.912
                    if hyb[j] == "sp2":
                        ka *= 1.35
                    if self.el[j] == "Mo":
                        ka *= 1.6
                    angle_terms.append((i, j, k, math.radians(theta0), ka))
        self.angle_terms = angle_terms

        # planarity: sp2 atoms with 3+ neighbors
        planars = []
        for j in range(n):
            if hyb[j] != "sp2":
                continue
            nbs = [i for i, _ in adj[j]]
            if len(nbs) >= 3:
                planars.append((j, nbs[0], nbs[1], nbs[2]))
        self.planars = planars

        bonded = set()
        for i, j, _ in self.bonds:
            bonded.add((i, j) if i < j else (j, i))
        one_three = set()
        for i, j, k, _, _ in angle_terms:
            a, b = (i, k) if i < k else (k, i)
            one_three.add((a, b))
        self.exclude = bonded | one_three

        # 1-4 pairs (scaled LJ)
        one_four = set()
        for i, j, order in self.bonds:
            for k, _ in adj[i]:
                if k == j:
                    continue
                for l, _ in adj[j]:
                    if l == i or l == k:
                        continue
                    a, b = (k, l) if k < l else (l, k)
                    if (a, b) in self.exclude or a == b:
                        continue
                    one_four.add((a, b))
        self.one_four = one_four

        pairs = []
        for i in range(n):
            for j in range(i + 1, n):
                key = (i, j)
                if key in self.exclude:
                    continue
                scale = 0.5 if key in one_four else 1.0
                di = _par(self.el[i])
                dj = _par(self.el[j])
                dij = math.sqrt(di[3] * dj[3])
                xij = math.sqrt(di[4] * dj[4])
                pairs.append((i, j, dij * scale, xij))
        self.pairs = pairs

    def energy_grad(self):
        n = self.n
        pos = self.pos
        energy = 0.0
        grad = [[0.0, 0.0, 0.0] for _ in range(n)]

        for i, j, r0, k in self.bond_terms:
            d = _sub(pos[j], pos[i])
            r = _len(d)
            if r < 1e-8:
                continue
            diff = r - r0
            energy += 0.5 * k * diff * diff
            # dE/dr * unit vector from i to j
            mag = k * diff / r
            fx, fy, fz = d[0] * mag, d[1] * mag, d[2] * mag
            # grad_i = -mag * d, grad_j = +mag * d
            grad[i][0] -= fx
            grad[i][1] -= fy
            grad[i][2] -= fz
            grad[j][0] += fx
            grad[j][1] += fy
            grad[j][2] += fz

        for i, j, k, theta0, ka in self.angle_terms:
            theta, g1, g2, g3 = _angle_grad(pos[i], pos[j], pos[k])
            if theta is None:
                continue
            delta = theta - theta0
            energy += 0.5 * ka * delta * delta
            dedt = ka * delta
            for t, g in ((i, g1), (j, g2), (k, g3)):
                grad[t][0] += dedt * g[0]
                grad[t][1] += dedt * g[1]
                grad[t][2] += dedt * g[2]

        cutoff2 = 81.0  # 9 A, always; small molecules still use every pair under it
        for i, j, dij, xij in self.pairs:
            d = _sub(pos[j], pos[i])
            r2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
            if r2 > cutoff2 or r2 < 1e-8:
                continue
            r = math.sqrt(r2)
            # soft wall if atoms crash
            if r < 0.55:
                r = 0.55
                r2 = r * r
            sr = xij / r
            sr2 = sr * sr
            sr6 = sr2 * sr2 * sr2
            sr12 = sr6 * sr6
            energy += dij * (sr12 - 2.0 * sr6)
            # dE/dr = 12*D/r * (sr^6 - sr^12)
            dedr = 12.0 * dij * (sr6 - sr12) / r
            mag = dedr / r
            fx, fy, fz = d[0] * mag, d[1] * mag, d[2] * mag
            grad[i][0] -= fx
            grad[i][1] -= fy
            grad[i][2] -= fz
            grad[j][0] += fx
            grad[j][1] += fy
            grad[j][2] += fz

        if self.full:
            kp = 90.0
            for c, a, b, d in self.planars:
                e, gs = _plane_grad(pos, c, a, b, d, kp)
                energy += e
                for t, g in gs:
                    grad[t][0] += g[0]
                    grad[t][1] += g[1]
                    grad[t][2] += g[2]

        for i in self.frozen:
            grad[i][0] = 0.0
            grad[i][1] = 0.0
            grad[i][2] = 0.0

        fmax = 0.0
        for i in range(n):
            if i in self.frozen:
                continue
            f = math.sqrt(grad[i][0] ** 2 + grad[i][1] ** 2 + grad[i][2] ** 2)
            if f > fmax:
                fmax = f
        return energy, grad, fmax

    def burst(self, count=5):
        last_e = None
        fmax = 0.0
        done = False
        for _ in range(count):
            if self.step >= self.max_steps:
                done = True
                break
            energy, grad, fmax = self.energy_grad()
            last_e = energy
            if fmax < self.tol:
                done = True
                if self.best_e is None or energy < self.best_e:
                    self.best_e = energy
                    self.best_pos = [p[:] for p in self.pos]
                break
            # trial step
            trial = [p[:] for p in self.pos]
            disp_cap = 0.12
            for i in range(self.n):
                if i in self.frozen:
                    continue
                dx = self.step_size * grad[i][0]
                dy = self.step_size * grad[i][1]
                dz = self.step_size * grad[i][2]
                # gradient descent: move against the gradient
                # grad already points uphill, so we subtract
                norm = math.sqrt(dx * dx + dy * dy + dz * dz)
                if norm > disp_cap and norm > 0:
                    s = disp_cap / norm
                    dx *= s
                    dy *= s
                    dz *= s
                trial[i][0] -= dx
                trial[i][1] -= dy
                trial[i][2] -= dz
            prev = self.pos
            self.pos = trial
            new_e, _, new_f = self.energy_grad()
            if new_e > energy + 1e-6:
                # reject, shrink
                self.pos = prev
                self.step_size = max(self.step_size * 0.5, 1e-6)
                last_e = energy
                fmax = fmax
            else:
                last_e = new_e
                fmax = new_f
                self.step_size = min(self.step_size * 1.12, 0.02 if self.full else 0.012)
                if self.best_e is None or new_e < self.best_e:
                    self.best_e = new_e
                    self.best_pos = [p[:] for p in self.pos]
            self.step += 1
            if fmax < self.tol:
                done = True
                break
        if self.step >= self.max_steps:
            done = True
        # if the last accepted geometry is worse than the best, restore best at the end
        if done and self.best_pos is not None:
            self.pos = [p[:] for p in self.best_pos]
            last_e = self.best_e
        return {
            "positions": self.pos,
            "energy": None if last_e is None else round(last_e, 4),
            "maxForce": round(fmax, 4),
            "step": self.step,
            "maxSteps": self.max_steps,
            "done": done,
            "engine": "python-uff",
        }


def _hybridization(el, orders):
    n = len(orders)
    total = 0.0
    max_o = 0.0
    for o in orders:
        total += o
        if o > max_o:
            max_o = o
    if el == "C":
        if n <= 2 and (max_o >= 2.5 or total >= 3.5):
            return "sp"
        if n == 3 or max_o >= 1.4:
            return "sp2"
        return "sp3"
    if el == "N":
        if max_o >= 1.4 or n <= 2:
            return "sp2"
        return "sp3"
    if el == "O":
        if max_o >= 1.4:
            return "sp2"
        return "sp3"
    if el == "S":
        return "sp3"
    if el == "Mo":
        return "sp3"
    return "sp3"


def _theta0(el, hyb):
    table = {
        ("C", "sp3"): 109.47,
        ("C", "sp2"): 120.0,
        ("C", "sp"): 180.0,
        ("N", "sp3"): 107.0,
        ("N", "sp2"): 120.0,
        ("N", "sp"): 180.0,
        ("O", "sp3"): 104.5,
        ("O", "sp2"): 120.0,
        ("S", "sp3"): 100.0,
        ("P", "sp3"): 100.0,
        ("Mo", "sp3"): 90.0,
        ("Si", "sp3"): 109.47,
    }
    if (el, hyb) in table:
        return table[(el, hyb)]
    return _par(el)[1]


def _bond_r0_k(el1, el2, order):
    pair = {el1, el2}
    p1 = _par(el1)
    p2 = _par(el2)
    ri = p1[0]
    rj = p2[0]
    bo = order if order > 0.2 else 1.0
    rbo = -0.1332 * (ri + rj) * math.log(bo)
    rij = ri + rj + rbo
    kij = 664.12 * p1[2] * p2[2] / (rij ** 3)
    # A few equilibrium lengths are pinned to textbook values so a
    # hand-drawn drug relaxes to a recognizable geometry. The force
    # constants stay on the UFF scale.
    if pair == {"Mo", "S"}:
        rij = 2.417
        kij = 280.0
    elif pair == {"C", "O"} and order >= 1.7:
        rij = 1.220
    elif pair == {"C", "O"} and order < 1.3:
        rij = 1.360
    elif pair == {"C", "C"} and 1.35 <= order <= 1.65:
        rij = 1.395
    elif pair == {"C", "C"} and order >= 1.9:
        rij = 1.340
    elif pair == {"C", "N"} and order >= 1.4:
        rij = 1.340
    return rij, kij


def _angle_grad(pi, pj, pk):
    """Return theta and d(theta)/d(coordinate) for atoms i, j, k."""
    v1 = _sub(pi, pj)
    v2 = _sub(pk, pj)
    r1 = _len(v1)
    r2 = _len(v2)
    if r1 < 1e-8 or r2 < 1e-8:
        return None, None, None, None
    u1 = (v1[0] / r1, v1[1] / r1, v1[2] / r1)
    u2 = (v2[0] / r2, v2[1] / r2, v2[2] / r2)
    c = u1[0] * u2[0] + u1[1] * u2[1] + u1[2] * u2[2]
    if c > 1.0:
        c = 1.0
    if c < -1.0:
        c = -1.0
    s = math.sqrt(max(1.0 - c * c, 1e-12))
    theta = math.acos(c)
    # d(theta)/d(pi)
    inv1 = 1.0 / (r1 * s)
    inv2 = 1.0 / (r2 * s)
    g1 = (
        (u1[0] * c - u2[0]) * inv1,
        (u1[1] * c - u2[1]) * inv1,
        (u1[2] * c - u2[2]) * inv1,
    )
    g3 = (
        (u2[0] * c - u1[0]) * inv2,
        (u2[1] * c - u1[1]) * inv2,
        (u2[2] * c - u1[2]) * inv2,
    )
    g2 = (-g1[0] - g3[0], -g1[1] - g3[1], -g1[2] - g3[2])
    return theta, g1, g2, g3


def _plane_grad(pos, ic, ia, ib, idd, k):
    """Height of atom ic above the plane through ia, ib, idd."""
    pa = pos[ia]
    pb = pos[ib]
    pd = pos[idd]
    pc = pos[ic]
    ab = _sub(pb, pa)
    ad = _sub(pd, pa)
    n = _cross(ab, ad)
    nn = _len(n)
    if nn < 1e-8:
        return 0.0, []
    nh = (n[0] / nn, n[1] / nn, n[2] / nn)
    h = _dot(_sub(pc, pa), nh)
    energy = 0.5 * k * h * h
    f = k * h
    gc = (f * nh[0], f * nh[1], f * nh[2])
    third = (-gc[0] / 3.0, -gc[1] / 3.0, -gc[2] / 3.0)
    return energy, ((ic, gc), (ia, third), (ib, third), (idd, third))


_SESSION = None


def start(payload):
    global _SESSION
    _SESSION = Session(payload)
    return _SESSION.burst(6)


def cont():
    if _SESSION is None:
        return {"error": "no session", "done": True}
    return _SESSION.burst(6)


def relax_all(payload):
    """Blocking helper used by the preset builder, not the UI."""
    session = Session(payload)
    report = None
    while True:
        report = session.burst(8)
        if report["done"]:
            return report


def start_json(payload_json):
    return json.dumps(start(json.loads(payload_json)))


def cont_json():
    return json.dumps(cont())
