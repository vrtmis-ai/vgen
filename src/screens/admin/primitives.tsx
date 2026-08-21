/**
 * The small shared pieces of the staff console.
 *
 * These lived in `RoutingSection` because it was the first screen to need a
 * table. Five screens need one now, and a dashboard importing its table from
 * the routing page is the kind of thing that quietly makes a file impossible to
 * delete later.
 *
 * **Latin digits throughout, and Persian labels.** The rest of the product uses
 * Persian numerals; this console deliberately does not. These are dense
 * financial columns that get compared down a page and pasted into a
 * spreadsheet, and ۱۲۳ survives neither.
 */
import type { ReactNode } from "react";

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr style={{ color: "var(--vg-text-faint)" }}>
            {head.map((label) => (
              <th key={label} className="pb-2 text-start font-medium">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({ children, dim = false }: { children: ReactNode; dim?: boolean }) {
  return (
    <td className="py-2 align-top" style={{ color: dim ? "var(--vg-text-faint)" : "var(--vg-text)" }}>
      {children}
    </td>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 text-[12.5px]" style={{ color: "var(--vg-text-faint)" }}>
      {children}
    </p>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return (
    <tr className="border-t align-top" style={{ borderColor: "var(--vg-border-subtle)" }}>
      {children}
    </tr>
  );
}

/** Grouped thousands, no currency symbol — the column header says what it is. */
export const num = (value: number, digits = 0): string =>
  value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const usd = (value: number): string => `$${num(value, value !== 0 && Math.abs(value) < 1 ? 4 : 2)}`;

/**
 * Toman, from a Rial amount.
 *
 * `plans.price_amount` and `orders.amount` are IRR. Iranians price in Toman —
 * a tenth of a Rial — and a figure ten times too large is the single easiest
 * way for this panel to be wrong in a way nobody notices for a week.
 */
export const toman = (rial: number): string => `${num(Math.round(rial / 10))} تومان`;

export const when = (ms: number | null): string => {
  if (ms === null) return "—";
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days === 0) return "امروز";
  if (days === 1) return "دیروز";
  if (days < 30) return `${days} روز پیش`;
  return new Date(ms).toISOString().slice(0, 10);
};

/**
 * A number and what it means, for the strip across the top.
 *
 * `hint` is where a figure gets to explain itself. A dashboard that shows
 * "$0.00" with no note is indistinguishable from a broken query, and several
 * of these are legitimately zero right now.
 */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  tone?: "good" | "bad" | undefined;
}) {
  const color = tone === "good" ? "var(--vg-primary-soft)" : tone === "bad" ? "var(--vg-danger, #ff6c52)" : "var(--vg-text)";
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}>
      <div className="text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
        {label}
      </div>
      <div className="mt-1 text-[17px] font-extrabold tabular-nums" style={{ color, fontFamily: "var(--vg-font-display)" }} dir="ltr">
        {value}
      </div>
      {hint ? (
        <div className="mt-0.5 text-[10.5px] leading-4" style={{ color: "var(--vg-text-faint)" }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
