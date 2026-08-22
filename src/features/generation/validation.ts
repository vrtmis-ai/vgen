import type { InputMap, RefMap } from "../../components/controls";
import { variantControls, variantMaxPrompt, variantRefs, type Control, type Family, type RefSlot, type Variant } from "../../data/models";
import { ApiError } from "../../adapters/http/client";

export type GenerationValidationCode =
  | "prompt_required"
  | "prompt_too_long"
  | "invalid_control"
  | "unknown_control"
  | "reference_required"
  | "reference_dependency"
  | "too_many_files"
  | "invalid_mime"
  | "file_too_large"
  | "invalid_duration"
  | "unknown_reference";

export interface GenerationValidationIssue {
  code: GenerationValidationCode;
  path: string;
  message: string;
}

export interface GenerationValidationResult {
  valid: boolean;
  issues: GenerationValidationIssue[];
}

/**
 * What each API refusal means to the person who pressed the button.
 *
 * Branch on `code`, never on `message` — `docs/API.md` is explicit that codes
 * are the contract and messages are prose. The codes below are the ones the API
 * actually sends, taken from the quote, submit and job-failure tables in that
 * file. The previous list predated all three routes going live and named three
 * codes nothing sends — `insufficient_balance`, `locked_model` and
 * `unsupported_combination` — while the real names for those same two refusals,
 * `insufficient_credits` and `tier_too_low`, fell through to "try again". They
 * are the two most likely refusals there are, and "try again" helps with
 * neither: one needs a top-up and the other needs an upgrade.
 *
 * Grouped by what the person can do about it, because that is the only reason
 * the API keeps them apart: collapsing them into one code would leave the
 * screen guessing which.
 */
const GENERATION_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  // Fixed by spending money. 403 rather than 402 on tier is deliberate upstream:
  // the account is not short of coins, it is on the wrong plan, and the fix is
  // an upgrade rather than a top-up. So these two must not share a message.
  insufficient_credits: "اعتبار کیف پول برای این ساخت کافی نیست؛ اول کیف پول را شارژ کنید.",
  tier_too_low: "این مدل در پلن فعلی شما نیست؛ برای استفاده از آن پلن را ارتقا دهید.",
  allowance_spent: "سهمیهٔ رایگان امروزتان تمام شد؛ از این پس این ساخت از سکه‌هایتان کم می‌کند.",

  // Fixed by changing the request.
  not_offered: "این ترکیب تنظیمات ارائه نمی‌شود؛ یکی از گزینه‌ها را عوض کنید.",
  params_mismatch: "تنظیمات بعد از قیمت‌گیری عوض شد؛ دوباره تلاش کنید تا قیمت تازه گرفته شود.",

  // Fixed by waiting, then trying the same thing again.
  concurrency_reached: "به سقف ساخت‌های هم‌زمان پلن‌تان رسیده‌اید؛ تا تمام‌شدن یکی از آن‌ها صبر کنید.",
  rate_limited: "تعداد درخواست‌ها زیاد شده است؛ چند لحظه بعد دوباره تلاش کنید.",

  // Fixed by asking again — the quote went stale, not the request.
  quote_expired: "قیمت این ساخت منقضی شده؛ دوباره تلاش کنید تا قیمت تازه گرفته شود.",
  quote_unavailable: "این قیمت دیگر معتبر نیست؛ دوباره تلاش کنید.",
  quote_spent: "این درخواست قبلاً ثبت شده است؛ نتیجه‌اش را در کارهایتان دنبال کنید.",
  idempotency_conflict: "این درخواست با یک ساخت دیگر تداخل دارد؛ چند لحظه بعد دوباره تلاش کنید.",

  // Nothing the person chose is wrong, and nothing they can do will change it.
  unknown_variant: "این مدل دیگر در دسترس نیست؛ صفحه را تازه کنید.",
  no_price: "قیمتی برای این ترکیب پیدا نشد. این ایراد از سمت ماست، نه از انتخاب شما.",

  /* A job that failed after it was queued. Every one of these ends in a refund —
     the worker either captures the hold because a file exists or releases it
     because one does not, and there is no third exit — so each one says so.
     Somebody who watched coins leave their wallet and then saw the job fail
     needs telling that the two cancelled out. */
  provider_unavailable: "ارائه‌دهندهٔ این مدل در دسترس نیست؛ سکه‌ای از شما کم نشد.",
  credential_unavailable: "این مدل در حال حاضر قابل اجرا نیست؛ سکه‌ای از شما کم نشد.",
  submit_failed: "ارائه‌دهنده این درخواست را نپذیرفت؛ سکه‌ای از شما کم نشد.",
  poll_failed: "ارائه‌دهنده دیگر دربارهٔ این ساخت پاسخ نداد؛ سکه‌ای از شما کم نشد.",
  provider_timeout: "این ساخت به نتیجه نرسید؛ سکه‌ای از شما کم نشد.",
  /* The worker normalises every provider-specific failure code into one of
     these two before it leaves the server, so they are the codes a customer
     actually receives when a generation is refused upstream. Without an entry
     each would fall through to the generic fallback -- which is what happened
     to every KIE failure, because KIE returns its own `failCode` string. */
  provider_failed: "ارائه‌دهنده نتوانست این ساخت را کامل کند؛ سکه‌ای از شما کم نشد.",
  /* The one refusal the person can do something about: change the words. */
  content_policy: "این درخواست پذیرفته نشد؛ متن را عوض کنید و دوباره تلاش کنید. سکه‌ای از شما کم نشد.",
  provider_cancelled: "این ساخت پیش از پایان لغو شد؛ سکه‌ای از شما کم نشد.",
  storage_failed: "ساخت انجام شد اما ذخیره نشد؛ سکه‌ای از شما کم نشد.",
  no_output: "هیچ خروجی‌ای ساخته نشد؛ سکه‌ای از شما کم نشد.",

  /* Never reached the API at all. `src/adapters/http/client.ts` raises these
     itself, so they carry status 0 and no server ever saw the request — which
     is worth saying, because "try again" is genuinely the right advice here and
     nowhere else. `request_aborted` is deliberately absent: the only thing that
     aborts a request is the screen navigating away or a newer request replacing
     it, and neither is a failure to report. */
  request_timeout: "پاسخ سرور طول کشید؛ دوباره تلاش کنید.",
  network_error: "ارتباط با سرور برقرار نشد؛ اتصال اینترنت را بررسی کنید.",
  invalid_response: "پاسخ سرور قابل خواندن نبود؛ دوباره تلاش کنید.",
};

const GENERATION_ERROR_FALLBACK = "ساخت محتوا انجام نشد؛ دوباره تلاش کنید.";

export function generationErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERATION_ERROR_FALLBACK;
  return GENERATION_ERROR_MESSAGES[error.code] ?? GENERATION_ERROR_FALLBACK;
}

function acceptsMime(slot: RefSlot, mime: string): boolean {
  const media = slot.media ?? "image";
  if (media === "image") return mime.startsWith("image/");
  if (media === "video") return ["video/mp4", "video/quicktime", "video/x-matroska"].includes(mime);
  return ["audio/mpeg", "audio/wav", "audio/x-wav"].includes(mime);
}

function validControlValue(control: Control, value: unknown): boolean {
  switch (control.kind) {
    case "aspect":
    case "segment":
      return control.options.some((option) => option.value === String(value));
    case "slider": {
      const numeric = typeof value === "number" ? value : control.asString && typeof value === "string" ? Number(value) : Number.NaN;
      if (!Number.isFinite(numeric) || numeric < control.min || numeric > control.max) return false;
      const steps = (numeric - control.min) / control.step;
      return Math.abs(steps - Math.round(steps)) < 1e-7;
    }
    case "toggle":
      return typeof value === "boolean";
    case "text":
      return typeof value === "string";
    case "voice":
      return typeof value === "string" && value.length > 0;
    default: {
      const unhandled: never = control;
      return unhandled;
    }
  }
}

export function validateGenerationInput({
  family,
  variant,
  prompt,
  input,
  refs,
}: {
  family: Family;
  variant: Variant;
  prompt: string;
  input: InputMap;
  refs: RefMap;
}): GenerationValidationResult {
  const issues: GenerationValidationIssue[] = [];
  const trimmedPrompt = prompt.trim();
  const maxPrompt = variantMaxPrompt(family, variant);
  if (!family.noPrompt && trimmedPrompt.length === 0) {
    issues.push({ code: "prompt_required", path: "prompt", message: "پرامپت الزامی است." });
  }
  if (maxPrompt !== null && trimmedPrompt.length > maxPrompt) {
    issues.push({ code: "prompt_too_long", path: "prompt", message: `پرامپت باید حداکثر ${maxPrompt} نویسه باشد.` });
  }

  const controls = variantControls(family, variant);
  const controlKeys = new Set(controls.map((control) => control.key));
  for (const key of Object.keys(input)) {
    if (!controlKeys.has(key)) issues.push({ code: "unknown_control", path: `input.${key}`, message: "این تنظیم متعلق به مدل فعلی نیست." });
  }
  for (const control of controls) {
    if (!validControlValue(control, input[control.key])) {
      issues.push({ code: "invalid_control", path: `input.${control.key}`, message: `${control.label} مقدار معتبر ندارد.` });
    }
  }

  const slots = variantRefs(family, variant);
  const slotKeys = new Set(slots.map((slot) => slot.key));
  for (const key of Object.keys(refs)) {
    if (!slotKeys.has(key)) issues.push({ code: "unknown_reference", path: `refs.${key}`, message: "این فایل متعلق به مدل فعلی نیست." });
  }
  for (const slot of slots) {
    const files = refs[slot.key] ?? [];
    if (slot.required && files.length === 0) {
      issues.push({ code: "reference_required", path: `refs.${slot.key}`, message: `${slot.label} الزامی است.` });
    }
    if (slot.requires && files.length > 0 && (refs[slot.requires]?.length ?? 0) === 0) {
      issues.push({ code: "reference_dependency", path: `refs.${slot.key}`, message: `${slot.label} به ورودی وابستهٔ خود نیاز دارد.` });
    }
    if (files.length > slot.max) {
      issues.push({ code: "too_many_files", path: `refs.${slot.key}`, message: `حداکثر ${slot.max} فایل مجاز است.` });
    }
    files.forEach((ref, index) => {
      const path = `refs.${slot.key}.${index}`;
      if (!acceptsMime(slot, ref.file.type)) {
        issues.push({ code: "invalid_mime", path, message: "نوع فایل با این ورودی سازگار نیست." });
      }
      if (slot.maxMb !== undefined && ref.file.size > slot.maxMb * 1024 * 1024) {
        issues.push({ code: "file_too_large", path, message: `حجم فایل باید حداکثر ${slot.maxMb} مگابایت باشد.` });
      }
      if (ref.duration !== undefined && (!Number.isFinite(ref.duration) || ref.duration <= 0)) {
        issues.push({ code: "invalid_duration", path, message: "مدت فایل قابل استفاده نیست." });
      }
    });
  }

  return { valid: issues.length === 0, issues };
}
