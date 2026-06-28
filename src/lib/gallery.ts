export type GenStatus = "running" | "done";

export interface Generation {
  id: string;
  familyId: string;
  variantId: string;
  name: string;
  vendor: string;
  grad: string;
  kind: "image" | "video";
  prompt: string;
  w: number;
  h: number;
  status: GenStatus;
  createdAt: number;
}

const KEY = "vgen:gens";

export function loadGenerations(): Generation[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]") as Generation[];
    // a "running" job can't survive a reload (the mock isn't actually running) — settle it
    return arr.map((g) => (g.status === "running" ? { ...g, status: "done" } : g));
  } catch {
    return [];
  }
}

export function saveGenerations(gens: Generation[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(gens));
  } catch {
    /* ignore */
  }
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
