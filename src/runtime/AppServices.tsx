import { createContext, useContext, type ReactNode } from "react";
import type {
  LoginInput,
  OAuthProvider,
  PhoneVerificationStarted,
  RegisterInput,
  StartPhoneVerificationInput,
  VerifyPhoneInput,
} from "./contracts/auth";
import type { Campaign } from "./contracts/campaign";
import type { CatalogSnapshot } from "./contracts/catalog";
import type { ContentSnapshot } from "./contracts/content";
import type { CommunityFeed } from "./contracts/community";
import type { GalleryPage, GalleryQuery } from "./contracts/gallery";
import type { PlansResponse } from "./contracts/plans";
import type { CreateGenerationRequest, GenerationJob, GenerationQuote, JobReference, QuoteGenerationRequest } from "./contracts/generation";
import type { UploadedAsset } from "./contracts/assets";
import type { CheckoutOrder, CreateCheckoutOrderInput } from "./contracts/payment";
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
     * Whether an invite code would admit someone right now. A hint for the
     * invite page, not the gate: signup checks the code again as it creates
     * the account.
     */
    checkInvite(code: string, options?: RequestOptions): Promise<boolean>;
    /**
     * Hands the browser to an identity provider.
     *
     * Unlike every other call here this is a *navigation*, not a request, and in
     * production it does not return — the page is gone. It cannot be a fetch:
     * the OAuth handshake sets an HttpOnly state cookie and a same-origin XHR
     * both fails CORS and drops that cookie. Failures come back as
     * `?auth=<code>` on the landing page rather than as a rejected promise.
     */
    startProviderSignIn(provider: OAuthProvider, inviteCode?: string, options?: RequestOptions): Promise<void>;
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
    /**
     * Say a published post should not be there.
     *
     * Hides nothing on its own — it puts the post in front of a moderator, who
     * has a takedown route. A report that un-published would be a veto anyone
     * could exercise with one click.
     */
    report(postId: string, input: { category: string; note?: string | undefined }, options?: RequestOptions): Promise<void>;
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
    list(options?: RequestOptions): Promise<PlansResponse>;
  };
  wallet: {
    getCurrent(options?: RequestOptions): Promise<Wallet>;
  };
  /**
   * The running price campaign, or null when there is none. Null is not an
   * error — it is most of the year, and it is what makes the plans banner
   * disappear rather than advertise a festival that is over.
   */
  campaign: {
    getActive(options?: RequestOptions): Promise<Campaign | null>;
  };
  /**
   * Checkout. The browser names a plan; the server prices it, reserves that
   * price, registers the payment with the gateway and answers with where to
   * send the person next. Nothing here computes an amount.
   */
  payment: {
    createOrder(input: CreateCheckoutOrderInput, options?: RequestOptions): Promise<CheckoutOrder>;
  };
  generation: {
    quote(request: QuoteGenerationRequest, options?: RequestOptions): Promise<GenerationQuote>;
    create(request: CreateGenerationRequest, options?: RequestOptions): Promise<GenerationJob>;
    getJob(jobId: string, options?: RequestOptions): Promise<GenerationJob>;
    /**
     * Where to send the browser to save an output, rather than look at it.
     *
     * A URL and not a request: the point is to let the browser do the download
     * itself, with its own progress and its own destination. Fetching the bytes
     * into the page to re-offer them would buy nothing and cost the whole file
     * in memory.
     */
    downloadUrl(jobId: string, index?: number): string;
    /**
     * The files a past generation was run against, so it can be run again with
     * them rather than without them.
     *
     * Asked for per generation, when somebody presses "generate again" — not
     * carried on the job, which would sign every reference of every gallery row
     * to serve a button pressed on one.
     */
    references(jobId: string, options?: RequestOptions): Promise<JobReference[]>;
    /**
     * Take a finished generation off the account's wall.
     *
     * Soft on the server — the row stays as the record of money that moved —
     * and refused while the job is still running, because a generation with
     * credits held against it cannot be made invisible without those coins
     * becoming unaccountable.
     */
    remove(jobId: string, options?: RequestOptions): Promise<void>;
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
