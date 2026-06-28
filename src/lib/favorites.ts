import { useCallback, useEffect, useState } from "react";

const KEY = "vgen:favs";

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

/** User's pinned model families, persisted to localStorage. */
export function useFavorites() {
  const [favs, setFavs] = useState<string[]>(read);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(favs));
    } catch {
      /* ignore */
    }
  }, [favs]);

  const toggle = useCallback((id: string) => {
    setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  }, []);

  const has = useCallback((id: string) => favs.includes(id), [favs]);

  return { favs, toggle, has };
}
