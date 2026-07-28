// ElevenLabs voices, as listed in KIE's text-to-speech API spec.
//
// KIE publishes no endpoint to enumerate these, so the list is copied from the
// spec. It also documents a preview per voice at a predictable URL — verified
// reachable and public, returning audio/mpeg — which is what makes choosing by
// ear possible without generating (and paying for) a sample first.

export interface Voice {
  id: string;
  name: string;
  /** The spec's own one-line character description. */
  note: string;
}

/** Public preview clip for a voice. No auth, no cost. */
export function voicePreviewUrl(id: string): string {
  return `https://static.aiquickdraw.com/elevenlabs/voice/${id}.mp3`;
}

export const VOICES: Voice[] = [
  { id: "EkK5I93UQWFDigLMpZcX", name: "James", note: "خش‌دار، گیرا و جسور" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", note: "پرانرژی، مناسب شبکه‌های اجتماعی" },
  { id: "NNl6r8mD7vthiJatiJt1", name: "Bradford", note: "رسا و شمرده" },
  { id: "Z3R5wn05IrDiVCyEkUrK", name: "Arabella", note: "مرموز و احساسی" },
  { id: "5l5f8iK3YPeGga21rQIX", name: "Adeline", note: "زنانه و گفتگویی" },
  { id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella", note: "حرفه‌ای، روشن و گرم" },
  { id: "BZgkqPqms7Kj9ulSkVzn", name: "Eve", note: "صمیمی، پرانرژی و شاد" },
  { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura", note: "پرشور با لحن بازیگوش" },
  { id: "uYXf8XasLslADfZ2MB4u", name: "Hope", note: "سرزنده و پرحرف" },
  { id: "iCrDUkL56s3C8sCRl7wb", name: "Hope (شاعرانه)", note: "رمانتیک و گیرا" },
  { id: "pPdl9cQBQq4p6mRkZy2Z", name: "Emma", note: "دوست‌داشتنی و پرانرژی" },
  { id: "Sm1seazb4gs7RSlUVw7c", name: "Anika", note: "پویا، دوستانه و جذاب" },
  { id: "6aDn1KB0hjpdcocrUkmq", name: "Tiffany", note: "طبیعی و خوشامدگو" },
  { id: "lcMyyd2HUfFzxdCaC4Ta", name: "Lucy", note: "تازه و خودمانی" },
  { id: "56AoDkrOh6qfVPDXZ7Pt", name: "Cassidy", note: "شفاف، مستقیم و واضح" },
  { id: "kPzsL2i3teMYv0FxEYQ6", name: "Brittney", note: "جوان و سرگرم‌کننده" },
  { id: "g6xIsTj2HwM6VR4iXFCw", name: "Jessica", note: "پرگو و دوستانه" },
  { id: "wJqPPQ618aTW29mptyoc", name: "Ana Rita", note: "نرم، رسا و روشن" },
  { id: "eVItLK1UvXctxuaRV2Oq", name: "Jean", note: "اغواگر و بازیگوش" },
  { id: "1wGbFxmAM3Fgw63G1zZJ", name: "Allison", note: "آرام، تسکین‌دهنده و مدیتیشن" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", note: "بم، طنین‌دار و آرامش‌بخش" },
  { id: "LruHrtVF6PSyGItzMNHS", name: "Benjamin", note: "بم، گرم و آرام" },
  { id: "MJ0RnG71ty4LH3dvNfSd", name: "Leon", note: "آرام و متین" },
  { id: "AeRdCCKzvd23BpJoofzx", name: "Nathaniel", note: "جذاب، بریتانیایی و آرام" },
  { id: "1SM7GgM6IMuvQlz2BwM3", name: "Mark", note: "خودمانی، ریلکس و سبک" },
  { id: "UgBBYS2sOqTuMpoF3BR0", name: "Mark (طبیعی)", note: "مناسب گفتگوی روزمره" },
  { id: "DYkrAHD8iwork3YSUBbs", name: "Tom", note: "گفتگو و کتاب صوتی" },
  { id: "6F5Zhi321D3Oq7v1oNT4", name: "Hank", note: "راوی بم و گیرا" },
  { id: "gs0tAILXbY5DNrJrsM6F", name: "Jeff", note: "باکلاس، طنین‌دار و قوی" },
  { id: "vBKc2FfBKJfcZNyEt1n6", name: "Finn", note: "جوان، مشتاق و پرانرژی" },
  { id: "DTKMou8ccj1ZaWGBiotd", name: "Jamahal", note: "جوان، سرزنده و طبیعی" },
  { id: "P1bg08DkjqiVEzOn76yG", name: "Viraj", note: "غنی و نرم" },
  { id: "qDuRKMlYmrm8trt5QyBn", name: "Taksh", note: "آرام، جدی و روان" },
  { id: "scOwDtmlUjD3prqpp97I", name: "Sam", note: "لحن پشتیبانی مشتری" },
  { id: "aD6riP1btT197c6dACmy", name: "Rachel M", note: "گوینده‌ی رادیوی بریتانیایی" },
  { id: "x70vRnQBMBu4FAYhjJbO", name: "Nathan", note: "مجری رادیو" },
  { id: "DGzg6RaUqxGRTHSBjfgF", name: "Brock", note: "آمرانه و بلند" },
  { id: "zYcjlYFOd3taleS0gkk3", name: "Edward", note: "بلند، مطمئن و متکبر" },
  { id: "YOq2y2Up4RgXP2HyXjE5", name: "Xavier", note: "گوینده‌ی مقتدر و فلزی" },
  { id: "LG95yZDEHg6fCZdQjLqj", name: "Phil", note: "گوینده‌ی پرشور و انفجاری" },
  { id: "TC0Zp7WVFzhA8zpTlRqV", name: "Aria", note: "شرور و اغواگر" },
  { id: "esy0r39YPLQjOczyOib8", name: "Britney", note: "شرورِ آرام و حساب‌گر" },
  { id: "flHkNRp1BlvT73UL6gyz", name: "Jessica (شرور)", note: "شرورِ فصیح" },
  { id: "ljo9gAlSqKOvF6D8sOsX", name: "Viking Bjorn", note: "مهاجم حماسی قرون‌وسطی" },
  { id: "ruirxsoakN0GWmGNIo04", name: "John Morgan", note: "کابوی خشن" },
  { id: "YXpFCvM1S3JbWEJhoskW", name: "Wyatt", note: "کابوی روستایی و دانا" },
];
