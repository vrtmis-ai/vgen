import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The shadcn class helper, as shipped with every component from that ecosystem.
 *
 * `clsx` flattens conditionals and arrays; `twMerge` resolves Tailwind conflicts
 * so a later class wins over an earlier one on the same property — which is what
 * makes `cn("px-5", props.className)` behave the way a caller expects when they
 * pass `px-8`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
