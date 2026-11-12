type PyodideLike = {
  runPython: (code: string) => unknown;
  globals: { set: (key: string, value: unknown) => void };
};

let py: PyodideLike | null = null;
let activeJob = 0;

function postError(message: string, during: string) {
  self.postMessage({ type: "error", message, during });
}

self.onmessage = (event: MessageEvent) => {
  const msg = event.data as {
    type: string;
    source?: string;
    job?: number;
    payload?: string;
  };
  void handle(msg);
};

async function handle(msg: { type: string; source?: string; job?: number; payload?: string }) {
  if (msg.type === "load") {
    try {
      const url: string = "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/pyodide.mjs";
      const mod = (await import(/* @vite-ignore */ url)) as {
        loadPyodide: (opts: { indexURL: string }) => Promise<PyodideLike>;
      };
      py = await mod.loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.27.5/full/",
      });
      py.runPython(msg.source ?? "");
      self.postMessage({ type: "ready" });
    } catch (err) {
      postError(err instanceof Error ? err.message : String(err), "load");
    }
    return;
  }

  if (!py) {
    postError("Python is not loaded yet.", "run");
    return;
  }

  if (msg.type === "start") {
    activeJob = msg.job ?? 0;
    try {
      py.globals.set("payload_json", msg.payload ?? "{}");
      const raw = py.runPython("start_json(payload_json)");
      self.postMessage({ type: "step", job: activeJob, result: JSON.parse(String(raw)) });
    } catch (err) {
      postError(err instanceof Error ? err.message : String(err), "run");
    }
    return;
  }

  if (msg.type === "cont") {
    if (msg.job !== activeJob) return;
    try {
      const raw = py.runPython("cont_json()");
      self.postMessage({ type: "step", job: activeJob, result: JSON.parse(String(raw)) });
    } catch (err) {
      postError(err instanceof Error ? err.message : String(err), "run");
    }
  }
}

export {};
