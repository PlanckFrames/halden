import { elementOf, idealBond } from "./elements";
import type { Atom, Bond, Molecule, Vec3 } from "./types";

export function v3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function norm(a: Vec3): Vec3 {
  const n = len(a);
  if (n < 1e-12) return [0, 0, 0];
  return scale(a, 1 / n);
}

export function dist(a: Atom | Vec3, b: Atom | Vec3): number {
  const pa = "el" in a ? v3(a.x, a.y, a.z) : a;
  const pb = "el" in b ? v3(b.x, b.y, b.z) : b;
  return len(sub(pa, pb));
}

export function angleDeg(a: Vec3, b: Vec3, c: Vec3): number {
  const u = norm(sub(a, b));
  const v = norm(sub(c, b));
  const cth = Math.min(1, Math.max(-1, dot(u, v)));
  return (Math.acos(cth) * 180) / Math.PI;
}

export function dihedralDeg(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const b1 = sub(b, a);
  const b2 = sub(c, b);
  const b3 = sub(d, c);
  const n1 = cross(b1, b2);
  const n2 = cross(b2, b3);
  const b2n = norm(b2);
  const m1 = cross(n1, b2n);
  const x = dot(n1, n2);
  const y = dot(m1, n2);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

export function atomPos(a: Atom): Vec3 {
  return [a.x, a.y, a.z];
}

export function cloneMolecule(mol: Molecule): Molecule {
  return {
    ...mol,
    atoms: mol.atoms.map((a) => ({ ...a })),
    bonds: mol.bonds.map((b) => ({ ...b })),
    cell: mol.cell
      ? {
          origin: [...mol.cell.origin],
          a: [...mol.cell.a],
          b: [...mol.cell.b],
          c: [...mol.cell.c],
        }
      : null,
  };
}

export function neighborsOf(bonds: Bond[], index: number): number[] {
  const out: number[] = [];
  for (const b of bonds) {
    if (b.i === index) out.push(b.j);
    else if (b.j === index) out.push(b.i);
  }
  return out;
}

export function bondBetween(bonds: Bond[], i: number, j: number): Bond | undefined {
  return bonds.find((b) => (b.i === i && b.j === j) || (b.i === j && b.j === i));
}

function perp(v: Vec3): Vec3 {
  const axis: Vec3 = Math.abs(v[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return norm(cross(v, axis));
}

function preferredAngle(el: string, orders: number[]): number {
  const maxO = orders.reduce((m, o) => Math.max(m, o), 0);
  const total = orders.reduce((s, o) => s + o, 0);
  const n = orders.length;
  if (el === "C") {
    if (n <= 2 && (maxO >= 2.5 || total >= 3.5)) return 180;
    if (maxO >= 1.4 || n >= 3) return 120;
    return 109.47;
  }
  if (el === "N") return maxO >= 1.4 || n <= 2 ? 120 : 107;
  if (el === "O") return 104.5;
  if (el === "S" || el === "P") return 100;
  return 109.47;
}

export function placeNext(origin: Vec3, nbrs: Vec3[], elCenter: string, elNew: string, order: number, angleDegValue: number): Vec3 {
  const bondLen = idealBond(elCenter, elNew, order);
  const theta = (angleDegValue * Math.PI) / 180;
  const n = nbrs.length;
  let direction: Vec3;
  if (n === 0) {
    direction = [1, 0, 0];
  } else if (n === 1) {
    const bond = norm(sub(nbrs[0]!, origin));
    const side = perp(bond);
    direction = norm(add(scale(bond, Math.cos(theta)), scale(side, Math.sin(theta))));
  } else if (n >= 2 && angleDegValue > 115) {
    const v1 = norm(sub(nbrs[0]!, origin));
    const v2 = norm(sub(nbrs[1]!, origin));
    const bis = add(v1, v2);
    direction = len(bis) < 1e-6 ? perp(v1) : scale(norm(bis), -1);
  } else if (n === 2) {
    const v1 = norm(sub(nbrs[0]!, origin));
    const v2 = norm(sub(nbrs[1]!, origin));
    const summed = add(v1, v2);
    const u = len(summed) < 1e-6 ? perp(v1) : scale(norm(summed), -1);
    const nv = norm(cross(v1, v2));
    const udot = dot(u, v1);
    const a = Math.abs(udot) < 1e-6 ? 0 : Math.max(-1, Math.min(1, Math.cos(theta) / udot));
    const b = Math.sqrt(Math.max(0, 1 - a * a));
    direction = norm(add(scale(u, a), scale(nv, b)));
  } else {
    let acc: Vec3 = [0, 0, 0];
    for (const p of nbrs) acc = add(acc, norm(sub(p, origin)));
    direction = len(acc) < 1e-8 ? [0, 0, 1] : scale(norm(acc), -1);
  }
  return add(origin, scale(direction, bondLen));
}

const HYDROGEN_HOSTS = new Set(["C", "N", "O", "S", "P", "Si", "F", "Cl", "Br", "I"]);

export function addHydrogens(mol: Molecule): Molecule {
  const next = cloneMolecule(mol);
  const original = next.atoms.length;
  for (let i = 0; i < original; i++) {
    const atom = next.atoms[i]!;
    if (!HYDROGEN_HOSTS.has(atom.el)) continue;
    const valence = elementOf(atom.el).valence;
    const orders = next.bonds.filter((b) => b.i === i || b.j === i).map((b) => b.order);
    let used = orders.reduce((s, o) => s + o, 0);
    let guard = 0;
    while (used < valence - 0.2 && guard < 6) {
      const nbs = neighborsOf(next.bonds, i).map((j) => atomPos(next.atoms[j]!));
      const angle = preferredAngle(atom.el, next.bonds.filter((b) => b.i === i || b.j === i).map((b) => b.order));
      const xyz = placeNext(atomPos(atom), nbs, atom.el, "H", 1, angle);
      const h: Atom = { el: "H", x: xyz[0], y: xyz[1], z: xyz[2], frozen: false };
      const hi = next.atoms.length;
      next.atoms.push(h);
      next.bonds.push({ i, j: hi, order: 1 });
      used += 1;
      guard += 1;
    }
  }
  return next;
}

export function perceiveBonds(atoms: Atom[]): Bond[] {
  const bonds: Bond[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const ri = elementOf(atoms[i]!.el).cov;
    for (let j = i + 1; j < atoms.length; j++) {
      const rj = elementOf(atoms[j]!.el).cov;
      let cutoff = (ri + rj) * 1.22;
      if (atoms[i]!.el === "S" && atoms[j]!.el === "S") cutoff = 2.15;
      const d = dist(atoms[i]!, atoms[j]!);
      if (d < 0.4 || d > cutoff) continue;
      let order = 1;
      const pair = [atoms[i]!.el, atoms[j]!.el].sort().join("-");
      if (pair === "C-O" && d < 1.3) order = 2;
      else if (pair === "C-C" && d < 1.28) order = 2;
      else if (pair === "C-C" && d < 1.45) order = 1.5;
      else if (pair === "C-N" && d < 1.32) order = 2;
      bonds.push({ i, j, order });
    }
  }
  return bonds;
}

export function deleteAtoms(mol: Molecule, ids: number[]): Molecule {
  const drop = new Set(ids);
  if (drop.size === 0) return mol;
  const map = new Map<number, number>();
  const atoms: Atom[] = [];
  mol.atoms.forEach((atom, index) => {
    if (drop.has(index)) return;
    map.set(index, atoms.length);
    atoms.push({ ...atom });
  });
  const bonds: Bond[] = [];
  for (const bond of mol.bonds) {
    if (drop.has(bond.i) || drop.has(bond.j)) continue;
    bonds.push({ i: map.get(bond.i)!, j: map.get(bond.j)!, order: bond.order });
  }
  return { ...mol, atoms, bonds };
}

export function measureSelection(mol: Molecule, selected: number[]): string | null {
  const ids = selected.filter((i) => i >= 0 && i < mol.atoms.length);
  if (ids.length === 2) {
    const d = dist(mol.atoms[ids[0]!]!, mol.atoms[ids[1]!]!);
    return `${d.toFixed(3)} Å`;
  }
  if (ids.length === 3) {
    const a = atomPos(mol.atoms[ids[0]!]!);
    const b = atomPos(mol.atoms[ids[1]!]!);
    const c = atomPos(mol.atoms[ids[2]!]!);
    return `${angleDeg(a, b, c).toFixed(1)}°`;
  }
  if (ids.length === 4) {
    const pts = ids.map((i) => atomPos(mol.atoms[i]!));
    return `${dihedralDeg(pts[0]!, pts[1]!, pts[2]!, pts[3]!).toFixed(1)}°`;
  }
  return null;
}

export type ParsedCoords =
  | { ok: true; mol: Molecule; replacedElements: boolean }
  | { ok: false; error: string };

export function parseCoordinateText(text: string, current: Molecule): ParsedCoords {
  const raw = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("!"));
  if (raw.length === 0) return { ok: false, error: "Nothing to read." };

  let body = raw;
  if (/^\d+$/.test(raw[0]!)) {
    const n = Number(raw[0]);
    body = raw.slice(2, 2 + n);
    if (body.length < n) return { ok: false, error: `Expected ${n} coordinate lines.` };
  }

  const rows: { el?: string; x: number; y: number; z: number }[] = [];
  for (const line of body) {
    const parts = line.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3) continue;
    const nums = parts.slice(-3).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    const maybeEl = parts.length >= 4 ? parts[0] : undefined;
    const el = maybeEl && /[A-Za-z]/.test(maybeEl) ? normalizeElement(maybeEl) : undefined;
    rows.push({ el, x: nums[0]!, y: nums[1]!, z: nums[2]! });
  }
  if (rows.length === 0) return { ok: false, error: "No coordinates found." };

  const sameCount = rows.length === current.atoms.length && rows.every((r) => !r.el);
  if (sameCount || (rows.length === current.atoms.length && rows.every((r, i) => !r.el || r.el === current.atoms[i]!.el))) {
    const atoms = current.atoms.map((atom, i) => ({
      ...atom,
      x: rows[i]!.x,
      y: rows[i]!.y,
      z: rows[i]!.z,
      el: rows[i]!.el ?? atom.el,
    }));
    return { ok: true, replacedElements: false, mol: { ...current, atoms } };
  }

  const atoms: Atom[] = rows.map((r) => ({
    el: r.el ?? "C",
    x: r.x,
    y: r.y,
    z: r.z,
    frozen: false,
  }));
  return {
    ok: true,
    replacedElements: true,
    mol: {
      ...current,
      name: "Edited coordinates",
      subtitle: "Bonds perceived from distance",
      atoms,
      bonds: perceiveBonds(atoms),
      cell: null,
    },
  };
}

function normalizeElement(token: string): string {
  const cleaned = token.replace(/[^A-Za-z]/g, "");
  if (!cleaned) return "C";
  const symbol = cleaned[0]!.toUpperCase() + cleaned.slice(1).toLowerCase();
  return symbol;
}
