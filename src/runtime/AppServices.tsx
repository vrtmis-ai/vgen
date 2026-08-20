import { createContext, useContext, type ReactNode } from "react";
import type {
  LoginInput,
  OAuthProvider,
  PhoneVerificationStarted,
  RegisterInput,
  StartPhoneVerificationInput,
  VerifyPhoneInput,
} from "./contracts/auth";
import type { CatalogSnapshot } from "./contracts/catalog";
import type { ContentSnapshot } from "./contracts/content";
import type { CommunityFeed } from "./contracts/community";
import type { GalleryPage, GalleryQuery } from "./contracts/gallery";
import type { Plan } from "./contracts/plans";
import type { CreateGenerationRequest, GenerationJob, GenerationQuote, QuoteGenerationRequest } from "./contracts/generation";
import type { UploadedAsset } from "./contracts/assets";
import type { Session } from "./contracts/session";
import type { Wallet } from "./contracts/wallet";

export interface RequestOptions {
  signal?: AbortSignal | undefined;
}

export interface AppServices {
  session: {
    getCurrent(options?: RequestOptions): Promise<Session>;
  };
  /**
   * Credentials. Each of these ends with the server setting or clearing an
   * HttpOnly session cookie, which the browser cannot read — so they return the
   * resulting session rather than a token, and callers refetch rather than
   * storing anything.
   */
  auth: {
    startPhoneVerification(input: StartPhoneVerificationInput, options?: RequestOptions): Promise<PhoneVerificationStarted>;
    verifyPhone(input: VerifyPhoneInput, options?: RequestOptions): Promise<Session>;
    register(input: RegisterInput, options?: RequestOptions): Promise<Session>;
    login(input: LoginInput, options?: RequestOptions): Promise<Session>;
    /**
     * Hands the browser to an identity provider.
     *
     * Unlike every other call here this is a *navigation*, not a request, and in
     * production it does not return — the page is gone. It cannot be a fetch:
     * the OAuth handshake sets an HttpOnly state cookie and a same-origin XHR
     * both fails CORS and drops that cookie. Failures come back as
     * `?auth=<code>` on the landing page rather than as a rejected promise.
     */
    startProviderSignIn(provider: OAuthProvider, options?: RequestOptions): Promise<void>;
    logout(options?: RequestOptions): Promise<void>;
  };
  /**
   * Presets, the prompt bank, skills, the featured shelf, courses, examples
   * and voices. One call rather than seven, because every screen that needs
   * one of them boots through a shell that already fetches the catalog.
   */
  content: {
    list(options?: RequestOptions): Promise<ContentSnapshot>;
  };
  /** What people published. Approved posts only — the route decides, not a screen. */
  community: {
    list(options?: RequestOptions): Promise<CommunityFeed>;
  };
  catalog: {
    list(options?: RequestOptions): Promise<CatalogSnapshot>;
  };
  /**
   * The plan ladder. Public, unlike everything else here — someone deciding
   * whether to sign up has to see what a plan costs before they have an account
   * to see it with, so the landing page asks for this while anonymous.
   */
  plans: {
    list(options?: RequestOptions): Promise<Plan[]>;
  };
  wallet: {
    getCurrent(options?: RequestOptions): Promise<Wallet>;
  };
  generation: {
    quote(request: QuoteGenerationRequest, options?: RequestOptions): Promise<GenerationQuote>;
    create(request: CreateGenerationRequest, options?: RequestOptions): Promise<GenerationJob>;
    getJob(jobId: string, options?: RequestOptions): Promise<GenerationJob>;
  };
  gallery: {
    list(query?: GalleryQuery, options?: RequestOptions): Promise<GalleryPage>;
  };
  /**
   * Reference images the customer supplies.
   *
   * The file goes through our API rather than straight to storage on a signed
   * URL, so the object store never has to be reachable from a browser and the
   * server can check what the bytes actually are before keeping them.
   */
  assets: {
    upload(file: File, options?: RequestOptions): Promise<UploadedAsset>;
  };
}

const AppServicesContext = createContext<AppServices | null>(null);

export function AppServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>;
}

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (!services) throw new Error("App services are not available. Wrap the application in AppServicesProvider.");
  return services;
}
