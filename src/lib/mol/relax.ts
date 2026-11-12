import source from "./uff_engine.py?raw";

export type RelaxStep = {
  positions: number[][];
  energy: number | null;
  maxForce: number;
  step: number;
  maxSteps: number;
  done: boolean;
  engine?: string;
  error?: string;
};

export type RelaxPayload = {
  elements: string[];
  positions: number[][];
  bonds: number[][];
  frozen: number[];
  maxSteps?: number;
};

type Handler = (step: RelaxStep) => void;

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let job = 0;
let handler: Handler | null = null;

function ensureWorker(): Promise<void> {
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    worker = new Worker(new URL("../../workers/uff-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as { type: string; job?: number; result?: RelaxStep; message?: string; during?: string };
      if (data.type === "ready") {
        resolve();
        return;
      }
      if (data.type === "error" && data.during === "load") {
        ready = null;
        reject(new Error(data.message || "Python failed to load"));
        return;
      }
      if (data.type === "error") {
        handler?.({
          positions: [],
          energy: null,
          maxForce: 0,
          step: 0,
          maxSteps: 0,
          done: true,
          error: data.message || "Python error",
        });
        return;
      }
      if (data.type === "step" && data.job === job && data.result) handler?.(data.result);
    };
    worker.onerror = (event) => {
      ready = null;
      reject(new Error(event.message || "Python worker failed"));
    };
    worker.postMessage({ type: "load", source });
  });
  return ready;
}

export function onRelaxStep(next: Handler) {
  handler = next;
}

export async function bootPython(): Promise<void> {
  await ensureWorker();
}

export function beginRelax(payload: RelaxPayload): number {
  job += 1;
  const mine = job;
  worker?.postMessage({ type: "start", job: mine, payload: JSON.stringify(payload) });
  return mine;
}

export function continueRelax(id: number) {
  if (id !== job) return;
  worker?.postMessage({ type: "cont", job: id });
}

export function cancelRelax() {
  job += 1;
}
