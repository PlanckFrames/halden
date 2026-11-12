import { dihedralDeg, dist, angleDeg, atomPos } from "./geometry";
import type { Atom, Molecule } from "./types";

export type FormatId = "xyz" | "zmat" | "gaussian" | "qchem" | "adf" | "nwchem" | "orca" | "poscar";

export const FORMATS: { id: FormatId; label: string; ext: string; hint: string }[] = [
  { id: "xyz", label: "XYZ", ext: "xyz", hint: "Plain Cartesian coordinates" },
  { id: "zmat", label: "Z-matrix", ext: "zmat", hint: "Internal coordinates, a z-file" },
  { id: "gaussian", label: "Gaussian", ext: "gjf", hint: "Frozen atoms marked -1" },
  { id: "qchem", label: "Q-Chem", ext: "qcin", hint: "Fixed-atom constraints" },
  { id: "adf", label: "ADF / AMS", ext: "run", hint: "AMS geometry optimization" },
  { id: "nwchem", label: "NWChem", ext: "nw", hint: "DFT optimize with fix atom" },
  { id: "orca", label: "ORCA", ext: "inp", hint: "Cartesian constraints, 0-based" },
  { id: "poscar", label: "VASP POSCAR", ext: "vasp", hint: "Cell if the structure has one" },
];

function f(n: number): string {
  return n.toFixed(6);
}

function title(mol: Molecule): string {
  return mol.name.replace(/\s+/g, " ").trim() || "Halden structure";
}

function line(atom: Atom, frozenFlag: boolean): string {
  const sym = atom.el.padEnd(2, " ");
  const coords = `${f(atom.x)}  ${f(atom.y)}  ${f(atom.z)}`;
  return frozenFlag && atom.frozen ? `${sym}  ${coords}  -1` : `${sym}  ${coords}`;
}

function frozenIndices(mol: Molecule, base: 0 | 1): number[] {
  const out: number[] = [];
  mol.atoms.forEach((atom, i) => {
    if (atom.frozen) out.push(i + base);
  });
  return out;
}

export function toXYZ(mol: Molecule): string {
  const frozen = frozenIndices(mol, 1);
  const comment = [
    `Halden | ${title(mol)} | charge ${mol.charge} multiplicity ${mol.multiplicity}`,
    frozen.length ? `frozen 1-based ${frozen.join(",")}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  const rows = mol.atoms.map((atom) => `${atom.el.padEnd(2, " ")}  ${f(atom.x)}  ${f(atom.y)}  ${f(atom.z)}`);
  return [`${mol.atoms.length}`, comment, ...rows, ""].join("\n");
}

export function toZMatrix(mol: Molecule): string {
  const n = mol.atoms.length;
  if (n === 0) return "# empty\n";
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const bond of mol.bonds) {
    adj[bond.i]!.push(bond.j);
    adj[bond.j]!.push(bond.i);
  }
  const used = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  for (let start = 0; start < n; start++) {
    if (used[start]) continue;
    const queue = [start];
    used[start] = true;
    while (queue.length) {
      const i = queue.shift()!;
      order.push(i);
      for (const j of adj[i]!) {
        if (!used[j]) {
          used[j] = true;
          queue.push(j);
        }
      }
    }
  }
  const lineOf = new Map<number, number>();
  order.forEach((atom, index) => lineOf.set(atom, index + 1));
  const lines: string[] = [
    `# Z-matrix from Halden — ${title(mol)}`,
    `# charge ${mol.charge}  multiplicity ${mol.multiplicity}`,
    `# columns: element, bond-to, distance (Å), angle-to, angle (deg), dihedral-to, dihedral (deg)`,
    `# reference numbers are 1-based rows of this file, not the on-screen atom index`,
  ];
  const frozenRows = order.flatMap((atom, index) => (mol.atoms[atom]!.frozen ? [index + 1] : []));
  if (frozenRows.length) lines.push(`# frozen rows: ${frozenRows.join(" ")}`);

  const earlier = new Set<number>();
  order.forEach((atomIndex, k) => {
    const el = mol.atoms[atomIndex]!.el;
    if (k === 0) {
      lines.push(el);
      earlier.add(atomIndex);
      return;
    }
    const previous = order.slice(0, k);
    const bonded = adj[atomIndex]!.find((j) => earlier.has(j));
    const bondTo = bonded ?? previous[previous.length - 1]!;
    const r = dist(mol.atoms[atomIndex]!, mol.atoms[bondTo]!);
    if (k === 1) {
      lines.push(`${el}  ${lineOf.get(bondTo)}  ${f(r)}`);
      earlier.add(atomIndex);
      return;
    }
    const angleTo =
      adj[bondTo]!.find((j) => earlier.has(j) && j !== atomIndex) ??
      previous.find((j) => j !== bondTo)!;
    const ang = angleDeg(atomPos(mol.atoms[atomIndex]!), atomPos(mol.atoms[bondTo]!), atomPos(mol.atoms[angleTo]!));
    if (k === 2) {
      lines.push(`${el}  ${lineOf.get(bondTo)}  ${f(r)}  ${lineOf.get(angleTo)}  ${f(ang)}`);
      earlier.add(atomIndex);
      return;
    }
    const dihedralTo =
      adj[angleTo]!.find((j) => earlier.has(j) && j !== bondTo && j !== atomIndex) ??
      previous.find((j) => j !== bondTo && j !== angleTo)!;
    const dih = dihedralDeg(
      atomPos(mol.atoms[atomIndex]!),
      atomPos(mol.atoms[bondTo]!),
      atomPos(mol.atoms[angleTo]!),
      atomPos(mol.atoms[dihedralTo]!),
    );
    lines.push(
      `${el}  ${lineOf.get(bondTo)}  ${f(r)}  ${lineOf.get(angleTo)}  ${f(ang)}  ${lineOf.get(dihedralTo)}  ${f(dih)}`,
    );
    earlier.add(atomIndex);
  });
  return lines.join("\n") + "\n";
}

export function toGaussian(mol: Molecule): string {
  const rows = mol.atoms.map((atom) => line(atom, true));
  return [
    `%chk=${slug(mol.name)}.chk`,
    "%nprocshared=4",
    "%mem=2GB",
    "#p opt b3lyp/6-31g(d)",
    "",
    title(mol),
    "",
    `${mol.charge} ${mol.multiplicity}`,
    ...rows,
    "",
    "! A trailing -1 freezes that Cartesian center during the optimization.",
    "",
  ].join("\n");
}

export function toQChem(mol: Molecule): string {
  const frozen = frozenIndices(mol, 1);
  const rows = mol.atoms.map((atom) => `${atom.el}  ${f(atom.x)}  ${f(atom.y)}  ${f(atom.z)}`);
  const constraint =
    frozen.length === 0
      ? []
      : ["$opt", "CONSTRAINT", "fixed", frozen.join(" "), "endconstraint", "$end", ""];
  return [
    `$molecule`,
    `${mol.charge} ${mol.multiplicity}`,
    ...rows,
    `$end`,
    "",
    `$rem`,
    `jobtype                 opt`,
    `method                  b3lyp`,
    `basis                   6-31g*`,
    `$end`,
    "",
    ...constraint,
  ].join("\n");
}

export function toADF(mol: Molecule): string {
  const frozen = frozenIndices(mol, 1);
  const atoms = mol.atoms.map((atom) => `    ${atom.el}  ${f(atom.x)}  ${f(atom.y)}  ${f(atom.z)}`);
  const constraints =
    frozen.length === 0
      ? []
      : ["GeometryOptimization", "  Constraints", ...frozen.map((i) => `    Atom ${i}`), "  End", "End", ""];
  return [
    `# AMS / ADF input written by Halden`,
    `# ${title(mol)}`,
    "System",
    "  Atoms",
    ...atoms,
    "  End",
    `  Charge ${mol.charge}`,
    "End",
    "",
    "Task GeometryOptimization",
    "",
    ...constraints,
    "Engine ADF",
    "  Basis",
    "    Type TZP",
    "  End",
    "  XC",
    "    GGA BP86",
    "  End",
    "EndEngine",
    "",
  ].join("\n");
}

export function toNWChem(mol: Molecule): string {
  const frozen = frozenIndices(mol, 1);
  const rows = mol.atoms.map((atom) => `  ${atom.el}  ${f(atom.x)}  ${f(atom.y)}  ${f(atom.z)}`);
  const fixes = frozen.map((i) => `  fix atom ${i}`);
  return [
    `start ${slug(mol.name)}`,
    `title "${title(mol)}"`,
    `charge ${mol.charge}`,
    "",
    "geometry units angstroms noautosym",
    ...rows,
    "end",
    "",
    ...(fixes.length ? ["constraints", ...fixes, "end", ""] : []),
    "basis",
    "  * library 6-31g*",
    "end",
    "",
    "dft",
    "  xc b3lyp",
    "  mult " + mol.multiplicity,
    "end",
    "",
    "task dft optimize",
    "",
  ].join("\n");
}

export function toORCA(mol: Molecule): string {
  const frozen = frozenIndices(mol, 0);
  const rows = mol.atoms.map((atom) => `${atom.el}  ${f(atom.x)}  ${f(atom.y)}  ${f(atom.z)}`);
  const constraints =
    frozen.length === 0
      ? []
      : ["%geom", "  Constraints", ...frozen.map((i) => `    { C ${i} C }`), "  end", "end", ""];
  return [
    "# Halden — ORCA. Constraint indices are 0-based.",
    "! B3LYP def2-SVP OPT",
    ...constraints,
    `* xyz ${mol.charge} ${mol.multiplicity}`,
    ...rows,
    "*",
    "",
  ].join("\n");
}

export function toPOSCAR(mol: Molecule): string {
  const order: string[] = [];
  for (const atom of mol.atoms) if (!order.includes(atom.el)) order.push(atom.el);
  const counts = order.map((el) => mol.atoms.filter((atom) => atom.el === el).length);
  let ax: number[], ay: number[], az: number[];
  if (mol.cell) {
    ax = [...mol.cell.a];
    ay = [...mol.cell.b];
    az = [...mol.cell.c];
  } else {
    const xs = mol.atoms.map((a) => a.x);
    const ys = mol.atoms.map((a) => a.y);
    const zs = mol.atoms.map((a) => a.z);
    const pad = 6;
    const span = (vals: number[]) => Math.max(4, (vals.length ? Math.max(...vals) - Math.min(...vals) : 0) + pad);
    ax = [span(xs), 0, 0];
    ay = [0, span(ys), 0];
    az = [0, 0, span(zs)];
  }
  const origin = mol.cell ? mol.cell.origin : [0, 0, 0];
  const lines = order.flatMap((el) =>
    mol.atoms
      .filter((atom) => atom.el === el)
      .map((atom) => `${f(atom.x - origin[0])}  ${f(atom.y - origin[1])}  ${f(atom.z - origin[2])}`),
  );
  return [
    `Halden ${title(mol)}`,
    "1.0",
    ax.map((n) => f(n)).join("  "),
    ay.map((n) => f(n)).join("  "),
    az.map((n) => f(n)).join("  "),
    order.join("  "),
    counts.join("  "),
    "Cartesian",
    ...lines,
    "",
  ].join("\n");
}

export function renderFormat(mol: Molecule, id: FormatId): string {
  switch (id) {
    case "xyz":
      return toXYZ(mol);
    case "zmat":
      return toZMatrix(mol);
    case "gaussian":
      return toGaussian(mol);
    case "qchem":
      return toQChem(mol);
    case "adf":
      return toADF(mol);
    case "nwchem":
      return toNWChem(mol);
    case "orca":
      return toORCA(mol);
    case "poscar":
      return toPOSCAR(mol);
  }
}

export function slug(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "halden";
}
