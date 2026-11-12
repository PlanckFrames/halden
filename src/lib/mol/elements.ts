export type ElementInfo = {
  symbol: string;
  name: string;
  color: string;
  vdw: number;
  cov: number;
  valence: number;
  mass: number;
};

export const ELEMENTS: Record<string, ElementInfo> = {
  H: { symbol: "H", name: "Hydrogen", color: "#f2f0e8", vdw: 1.2, cov: 0.31, valence: 1, mass: 1.008 },
  C: { symbol: "C", name: "Carbon", color: "#6e6a60", vdw: 1.7, cov: 0.76, valence: 4, mass: 12.011 },
  N: { symbol: "N", name: "Nitrogen", color: "#4c6cb3", vdw: 1.55, cov: 0.71, valence: 3, mass: 14.007 },
  O: { symbol: "O", name: "Oxygen", color: "#c44b3c", vdw: 1.52, cov: 0.66, valence: 2, mass: 15.999 },
  F: { symbol: "F", name: "Fluorine", color: "#6fbf73", vdw: 1.47, cov: 0.57, valence: 1, mass: 18.998 },
  P: { symbol: "P", name: "Phosphorus", color: "#d08a3a", vdw: 1.8, cov: 1.07, valence: 3, mass: 30.974 },
  S: { symbol: "S", name: "Sulfur", color: "#d6c15a", vdw: 1.8, cov: 1.05, valence: 2, mass: 32.065 },
  Cl: { symbol: "Cl", name: "Chlorine", color: "#5eaf62", vdw: 1.75, cov: 0.99, valence: 1, mass: 35.453 },
  Br: { symbol: "Br", name: "Bromine", color: "#a15a3a", vdw: 1.85, cov: 1.14, valence: 1, mass: 79.904 },
  I: { symbol: "I", name: "Iodine", color: "#8a4ea3", vdw: 1.98, cov: 1.33, valence: 1, mass: 126.9 },
  Si: { symbol: "Si", name: "Silicon", color: "#c4b27a", vdw: 2.1, cov: 1.11, valence: 4, mass: 28.085 },
  Mo: { symbol: "Mo", name: "Molybdenum", color: "#6a93ad", vdw: 2.1, cov: 1.54, valence: 6, mass: 95.95 },
};

export const PALETTE = ["C", "H", "N", "O", "S", "P", "F", "Cl", "Br", "Mo"] as const;

const BOND_RADIUS: Record<string, number> = {
  H: 0.354,
  C: 0.757,
  N: 0.7,
  O: 0.658,
  F: 0.611,
  P: 1.117,
  S: 1.064,
  Cl: 1.044,
  Br: 1.26,
  I: 1.424,
  Si: 1.117,
  Mo: 1.473,
};

export function elementOf(symbol: string): ElementInfo {
  return (
    ELEMENTS[symbol] ?? {
      symbol,
      name: symbol,
      color: "#b7b3a6",
      vdw: 1.7,
      cov: 0.77,
      valence: 4,
      mass: 12,
    }
  );
}

export function idealBond(a: string, b: string, order: number): number {
  const pair = [a, b].sort().join("-");
  if (pair === "Mo-S") return 2.417;
  if (pair === "C-O" && order >= 1.7) return 1.22;
  if (pair === "C-O") return 1.36;
  if (pair === "C-C" && order >= 1.35 && order <= 1.65) return 1.395;
  if (pair === "C-C" && order >= 1.9) return 1.34;
  if (pair === "C-N" && order >= 1.4) return 1.34;
  const ri = BOND_RADIUS[a] ?? 1;
  const rj = BOND_RADIUS[b] ?? 1;
  const bo = order > 0.2 ? order : 1;
  return ri + rj - 0.1332 * (ri + rj) * Math.log(bo);
}

export function formulaOf(counts: Map<string, number>): string {
  const order = (el: string) => (el === "C" ? 0 : el === "H" ? 1 : 2);
  return [...counts.entries()]
    .sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]))
    .map(([el, n]) => (n === 1 ? el : `${el}${n}`))
    .join("");
}
