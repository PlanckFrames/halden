export type Vec3 = [number, number, number];

export type Atom = {
  el: string;
  x: number;
  y: number;
  z: number;
  frozen: boolean;
  /** PDB atom name, e.g. CA, when the structure came from a protein. */
  name?: string;
  /** Residue label, e.g. "THR 1". */
  res?: string;
};

export type Bond = {
  i: number;
  j: number;
  order: number;
};

export type Cell = {
  origin: Vec3;
  a: Vec3;
  b: Vec3;
  c: Vec3;
};

export type StyleName = "ball" | "stick" | "space" | "wire" | "ribbon";

export type Preset = {
  id: string;
  name: string;
  subtitle: string;
  detail: string;
  formula: string;
  style: StyleName;
  atoms: Atom[];
  bonds: Bond[];
  cell: Cell | null;
};

export type Molecule = {
  name: string;
  subtitle: string;
  atoms: Atom[];
  bonds: Bond[];
  cell: Cell | null;
  charge: number;
  multiplicity: number;
};

export type ToolName = "navigate" | "select" | "draw" | "move" | "erase" | "bond";
