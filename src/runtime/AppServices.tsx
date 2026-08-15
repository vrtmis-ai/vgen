import { createContext, useContext, type ReactNode } from "react";
import type { LoginInput, PhoneVerificationStarted, RegisterInput, StartPhoneVerificationInput, VerifyPhoneInput } from "./contracts/auth";
import type { CatalogSnapshot } from "./contracts/catalog";
import type { GalleryPage, GalleryQuery } from "./contracts/gallery";
import type { CreateGenerationRequest, GenerationJob, GenerationQuote, QuoteGenerationRequest } from "./contracts/generation";
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
    logout(options?: RequestOptions): Promise<void>;
  };
  catalog: {
    list(options?: RequestOptions): Promise<CatalogSnapshot>;
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
