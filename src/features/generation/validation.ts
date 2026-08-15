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

const GENERATION_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  insufficient_balance: "اعتبار کیف پول برای این ساخت کافی نیست.",
  locked_model: "این مدل در پلن فعلی شما فعال نیست.",
  unsupported_combination: "این ترکیب تنظیمات توسط مدل پشتیبانی نمی‌شود.",
  provider_unavailable: "ارائه‌دهندهٔ مدل موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کنید.",
  rate_limited: "تعداد درخواست‌ها زیاد شده است؛ چند لحظه بعد دوباره تلاش کنید.",
  request_timeout: "پاسخ سرور طول کشید؛ دوباره تلاش کنید.",
};

export function generationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return GENERATION_ERROR_MESSAGES[error.code] ?? "ساخت محتوا انجام نشد؛ دوباره تلاش کنید.";
  return "ساخت محتوا انجام نشد؛ دوباره تلاش کنید.";
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
