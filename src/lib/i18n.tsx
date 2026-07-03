/* Lightweight i18n — no library, one dictionary, direction-aware.
   fa = RTL + Vazirmatn (default) · en = LTR + Space Grotesk.
   Persisted in localStorage; <html lang/dir> kept in sync so CSS and the
   swipe-back gesture mirror automatically. */
import { createContext, useContext, useEffect, useState } from "react";
import { faNum } from "./format";

export type Lang = "fa" | "en";
const STORE_KEY = "vgen-lang";

const dict = {
  fa: {
    // nav
    nav_home: "خانه",
    nav_community: "کامیونیتی",
    nav_gallery: "گالری",
    nav_profile: "پروفایل",
    nav_create: "بساز",
    // home
    home_prompt: "امروز چی بسازیم؟",
    home_image: "عکس",
    home_video: "ویدیو",
    home_template: "تمپلیت",
    home_shortcuts: "میانبرهای تو",
    home_trending: "ترندها",
    home_foryou: "برای تو",
    home_more: "بیشتر",
    home_see_community: "دیدن همه در کامیونیتی",
    home_make: "بساز",
    // create sheet
    sheet_title: "چی بسازیم؟",
    sheet_image: "ساخت عکس",
    sheet_image_d: "از متن یا عکس",
    sheet_video: "ساخت ویدیو",
    sheet_video_d: "متن یا عکس به ویدیو",
    sheet_tpl: "تمپلیت‌ها",
    sheet_tpl_d: "شروعِ آماده",
    sheet_all: "همه‌ی مدل‌ها",
    sheet_all_d: "کاتالوگ کامل",
    // wallet
    w_title: "کیف پول",
    w_balance: "موجودیِ تو",
    w_coins: "سکه",
    w_plans: "پلن‌های اصلی",
    w_packs: "پک‌های کوچیک",
    w_gift: "سکه هدیه",
    w_first_off: "تخفیف خرید اول",
    w_yearly: "سالانه: ماهی",
    w_yearly_d: "پرداخت یکجای ۱۲ ماه",
    w_less: "کمتر از قیمت عادی",
    w_buy: "خرید",
    w_toman: "تومان",
    w_est_img: "عکس",
    w_est_vid: "ویدیو ۵ ثانیه",
    w_est_or: "یا",
    w_about: "≈",
    w_access: "دسترسی به مدل‌ها",
    w_access_base: "مدل‌های پایه (اقتصادی)",
    w_access_plus: "پایه +",
    w_access_all: "همه‌ی مدل‌ها، از جمله",
    w_tag_test: "برای تست",
    w_tag_gift: "۵٪ هدیه",
    w_tag_popular: "پرطرفدار",
    w_tag_best: "بهترین ارزش",
    w_foot1: "پرداخت با کارت بانکی از طریق زرین‌پال (به‌زودی فعال می‌شود).",
    w_foot2: "سکه‌ها برای ساختِ تصویر و ویدیو با مدل‌ها خرج می‌شوند.",
    // profile
    p_title: "پروفایل",
    p_guest: "کاربرِ مهمان",
    p_made: "ساخته‌شده",
    p_favs: "مدلِ منتخب",
    p_coins: "سکه",
    p_fav_models: "مدل‌های منتخب",
    p_wallet: "کیف پول و خرید سکه",
    p_gallery: "گالریِ من",
    p_items: "مورد",
    p_lang: "زبان",
    p_support: "پشتیبانی",
    p_soon: "به‌زودی",
    p_about: "درباره‌ی Vgen",
  },
  en: {
    nav_home: "Home",
    nav_community: "Community",
    nav_gallery: "Gallery",
    nav_profile: "Profile",
    nav_create: "Create",
    home_prompt: "What shall we make today?",
    home_image: "Image",
    home_video: "Video",
    home_template: "Templates",
    home_shortcuts: "Your shortcuts",
    home_trending: "Trending",
    home_foryou: "For you",
    home_more: "More",
    home_see_community: "See all in Community",
    home_make: "Create",
    sheet_title: "What shall we make?",
    sheet_image: "Make an image",
    sheet_image_d: "From text or a photo",
    sheet_video: "Make a video",
    sheet_video_d: "Text or image to video",
    sheet_tpl: "Templates",
    sheet_tpl_d: "Ready-made starts",
    sheet_all: "All models",
    sheet_all_d: "Full catalog",
    w_title: "Wallet",
    w_balance: "Your balance",
    w_coins: "coins",
    w_plans: "Main plans",
    w_packs: "Small packs",
    w_gift: "bonus coins",
    w_first_off: "off first purchase",
    w_yearly: "Yearly: ",
    w_yearly_d: "12 months paid upfront",
    w_less: "below the regular price",
    w_buy: "Buy",
    w_toman: "Toman",
    w_est_img: "images",
    w_est_vid: "5s videos",
    w_est_or: "or",
    w_about: "≈",
    w_access: "Model access",
    w_access_base: "Base (economy) models",
    w_access_plus: "Base +",
    w_access_all: "All models, including",
    w_tag_test: "For testing",
    w_tag_gift: "5% bonus",
    w_tag_popular: "Most popular",
    w_tag_best: "Best value",
    w_foot1: "Pay by bank card via ZarinPal (coming soon).",
    w_foot2: "Coins are spent on generating images and videos.",
    p_title: "Profile",
    p_guest: "Guest user",
    p_made: "Created",
    p_favs: "Favorites",
    p_coins: "Coins",
    p_fav_models: "Favorite models",
    p_wallet: "Wallet & buy coins",
    p_gallery: "My gallery",
    p_items: "items",
    p_lang: "Language",
    p_support: "Support",
    p_soon: "Soon",
    p_about: "About Vgen",
  },
} as const;

export type TKey = keyof typeof dict.fa;

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: TKey) => string;
  /** locale-aware integer formatting (fa digits in Persian) */
  n: (v: number) => string;
}

const Ctx = createContext<I18n>({
  lang: "fa",
  setLang: () => undefined,
  t: (k) => dict.fa[k],
  n: (v) => faNum(v.toLocaleString("en-US")),
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      return saved === "en" ? "en" : "fa";
    } catch {
      return "fa";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, lang);
    } catch {
      // storage blocked — language just won't persist
    }
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
  }, [lang]);

  const t = (k: TKey) => dict[lang][k] ?? dict.fa[k];
  const n = (v: number) => (lang === "fa" ? faNum(v.toLocaleString("en-US")) : v.toLocaleString("en-US"));

  return <Ctx.Provider value={{ lang, setLang, t, n }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  return useContext(Ctx);
}
