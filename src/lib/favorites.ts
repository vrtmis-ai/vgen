import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { readStoredCollection, writeStoredCollection } from "../adapters/browser/storage";

const KEY = "vgen:favs";

function read(): string[] {
  return readStoredCollection(KEY, z.string().trim().min(1));
}

/** User's pinned model families, persisted to localStorage. */
export function useFavorites() {
  const [favs, setFavs] = useState<string[]>(read);

  useEffect(() => {
    writeStoredCollection(KEY, favs);
  }, [favs]);

  const toggle = useCallback((id: string) => {
    setFavs((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]));
  }, []);

  const has = useCallback((id: string) => favs.includes(id), [favs]);

  return { favs, toggle, has };
}
