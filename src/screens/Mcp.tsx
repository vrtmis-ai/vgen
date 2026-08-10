import { useState } from "react";
import { motion } from "framer-motion";
import { Terminal, Copy, Check, PuzzlePiece, ArrowLeft, Lightning } from "@phosphor-icons/react";
import { SKILLS } from "../data/skills";
import { published } from "../data/content";
import { getFamily } from "../data/models";
import { CoinMark } from "../components/chrome";
import { useI18n } from "../lib/i18n";
import { BRAND } from "../data/brand";

/* ---------------------------------------------------------------------------
   MCP & CLI, with Skills on the same page.

   The Explore tile pointed here and the CTA was disabled, which is honest but
   is not a page. Both halves answer the same question — "use VGen from
   somewhere other than this website" — so they share a screen rather than
   becoming two nav items that each say "coming soon".

   Everything here is marked as not-yet-connected, because it is. The value of
   shipping the page now is that the setup is written down and the shape is
   fixed; the value of pretending it works would be negative.
   --------------------------------------------------------------------------- */

const art = (seed: string, w = 800, h = 450) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

const CONFIG = `{
  "mcpServers": {
    "vgen": {
      "command": "npx",
      "args": ["-y", "@vgen/mcp"],
      "env": { "VGEN_TOKEN": "<توکن شما>" }
    }
  }
}`;

/** Copy-to-clipboard with the state change on the button, not a toast — a toast
 *  for a copy is a notification about something the user just watched happen. */
function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative overflow-hidden rounded-xl" style={{ background: "var(--vg-canvas)", border: "1px solid var(--vg-border-subtle)" }}>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
        className="absolute top-2.5 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold"
        style={{ insetInlineEnd: "0.625rem", background: "var(--vg-surface-overlay)", color: copied ? "var(--vg-primary-soft)" : "var(--vg-text-muted)" }}
      >
        {copied ? <Check size={12} weight="bold" /> : <Copy size={12} />}
        {copied ? "کپی شد" : "کپی"}
      </button>
      {/* dir=ltr: this is code. Persian layout must not reorder a JSON body. */}
      <pre dir="ltr" className="hide-scrollbar overflow-x-auto p-4 text-start text-[12px] leading-6" style={{ color: "var(--vg-text-secondary)" }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function SkillCard({ skill, onOpen }: { skill: (typeof SKILLS)[number]; onOpen: () => void }) {
  const { n } = useI18n();
  return (
    <button onClick={onOpen} className="group block w-full text-start">
      <div className="overflow-hidden rounded-xl" style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}>
        <img src={art(skill.seed)} alt="" loading="lazy" className="aspect-video w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
      </div>
      <p className="mt-2.5 text-[14px] font-bold" style={{ color: "var(--vg-text)" }}>
        {skill.title}
      </p>
      <p className="mt-1 line-clamp-2 text-[12px] leading-5" style={{ color: "var(--vg-text-muted)" }}>
        {skill.blurb}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded-md px-1.5 py-0.5 text-[10.5px]" style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}>
          <span className="vg-numeric">{n(skill.steps.length)}</span> مرحله
        </span>
        {skill.coins != null && (
          <span className="ms-auto flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: "var(--vg-text)" }}>
            <CoinMark size={11} />
            <span className="vg-numeric">{n(skill.coins)}</span>
          </span>
        )}
      </div>
    </button>
  );
}

export default function Mcp({ onOpenModel }: { onOpenModel: (familyId: string, prompt?: string) => void }) {
  const { n } = useI18n();
  const skills = published(SKILLS);
  const [open, setOpen] = useState<(typeof SKILLS)[number] | null>(null);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto w-full max-w-[1000px] px-4 pb-20 pt-6">
      <div className="relative overflow-hidden rounded-2xl" style={{ background: "var(--vg-surface)" }}>
        <img src={art("vgen-mcp-hero", 1400, 620)} alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9), rgba(0,0,0,0.4) 70%)" }} />
        <div className="relative flex min-h-[280px] flex-col justify-end p-7 md:p-10">
          <span
            className="mb-3 w-fit rounded-md px-2 py-1 text-[11px] font-bold"
            style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
          >
            هنوز در دسترس نیست
          </span>
          <h1 className="text-[30px] font-extrabold leading-[1.2] md:text-[40px]" style={{ fontFamily: "var(--vg-font-display)" }}>
            <span style={{ color: "var(--vg-primary-soft)" }}>از هر جایی بساز،</span>
            <br />
            <span style={{ color: "var(--vg-text)" }}>نه فقط از این سایت</span>
          </h1>
          <p className="mt-3 max-w-[54ch] text-[13px] leading-6" style={{ color: "var(--vg-text-secondary)" }}>
            {`مدل‌های ${BRAND.name} `}را به‌عنوان ابزار به دستیار خودت وصل کن، یا جریان‌های چندمرحله‌ای را یک‌بار بنویس و هر بار با یک دستور اجرا کن.
          </p>
        </div>
      </div>

      {/* MCP */}
      <section className="mt-10">
        <div className="flex items-center gap-2">
          <Terminal size={18} style={{ color: "var(--vg-primary-soft)" }} />
          <h2 className="text-[20px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
            MCP و CLI
          </h2>
        </div>
        <p className="mt-1 max-w-[62ch] text-[13px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
          سرور MCP، مدل‌های ما را به‌صورت ابزار در اختیار کلاد می‌گذارد. یعنی می‌توانی وسط یک گفتگو بگویی «این صحنه را بساز» و خروجی در همین حساب ساخته شود — با همان سکه‌ها و همان قیمت‌ها.
        </p>

        <ol className="mt-5 flex flex-col gap-3">
          {[
            { t: "توکن بساز", d: "از پروفایل، یک توکن دسترسی بساز. توکن مثل رمز است — جایی نگذارش که دیگران ببینند." },
            { t: "به تنظیمات کلاد اضافه کن", d: "این بلوک را در فایل پیکربندی MCP بگذار و توکن را جایگزین کن." },
            { t: "کلاد را دوباره باز کن", d: `ابزارهای ${BRAND.name} در فهرست ابزارهای کلاد ظاهر می‌شوند.` },
          ].map((s, i) => (
            <li key={s.t} className="flex gap-3">
              <span
                className="vg-numeric mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[11.5px] font-bold"
                style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
              >
                {n(i + 1)}
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-bold" style={{ color: "var(--vg-text)" }}>
                  {s.t}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
                  {s.d}
                </span>
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-4">
          <CodeBlock code={CONFIG} />
        </div>
      </section>

      {/* Skills */}
      <section className="mt-12">
        <div className="flex items-center gap-2">
          <PuzzlePiece size={18} style={{ color: "var(--vg-primary-soft)" }} />
          <h2 className="text-[20px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
            مهارت‌ها
          </h2>
        </div>
        <p className="mt-1 max-w-[62ch] text-[13px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
          یک مهارت، چند مدل پشت سر هم است که یک‌بار چیده می‌شود و هر بار با یک ورودی اجرا می‌شود. هزینه‌اش جمع مراحلش است و قبل از اجرا نشان داده می‌شود.
        </p>

        <div className="mt-5 grid gap-x-4 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
          {skills.map((s) => (
            <SkillCard key={s.id} skill={s} onOpen={() => setOpen(s)} />
          ))}
        </div>
      </section>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center" style={{ background: "rgba(9,9,9,0.9)" }} onClick={() => setOpen(null)}>
          <div
            className="max-h-[86dvh] w-full max-w-[520px] overflow-y-auto rounded-t-3xl p-5 sm:rounded-3xl"
            style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <img src={art(open.seed)} alt="" className="mb-4 aspect-video w-full rounded-xl object-cover" />
            <h3 className="text-[19px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
              {open.title}
            </h3>
            <p className="mt-1.5 text-[13px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
              {open.blurb}
            </p>

            {/* The steps are the product. Showing which model runs each one is
                what makes the coin total believable. */}
            <div className="mt-4 flex flex-col gap-2">
              {open.steps.map((st, i) => (
                <div key={i} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ background: "var(--vg-canvas)" }}>
                  <span className="vg-numeric text-[11.5px]" style={{ color: "var(--vg-text-faint)" }}>
                    {n(i + 1)}
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px]" style={{ color: "var(--vg-text)" }}>
                    {st.label}
                  </span>
                  {st.familyId && (
                    <button
                      onClick={() => {
                        setOpen(null);
                        onOpenModel(st.familyId!);
                      }}
                      className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px]"
                      style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
                    >
                      <bdi>{getFamily(st.familyId)?.name}</bdi>
                      <ArrowLeft size={10} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              disabled
              className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[13.5px] font-bold"
              style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-faint)" }}
            >
              <Lightning size={15} />
              اجرای مهارت — به‌زودی
            </button>
            <p className="mt-2 text-center text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
              فعلاً می‌توانی مرحله‌ها را دستی و یکی‌یکی اجرا کنی.
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
}
