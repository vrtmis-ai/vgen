import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { lazy, Suspense } from "react";
import { defaultInput, variantControls, type Variant } from "./data/models";
import type { InputMap, RefMap } from "./components/controls";
import { type Generation, loadGenerations, saveGenerations, uid } from "./lib/gallery";
import { startKieRates } from "./lib/kieRates";
import { useSwipeBack } from "./lib/useSwipeBack";
import { pageFade } from "./lib/motion";
import { AccessProvider } from "./lib/access";
import { TopBar, type NavKey } from "./components/TopBar";
import { currentAspect } from "./features/generation/aspect";
import { Navigate, matchPath, useLocation, useNavigate } from "react-router-dom";
import { navKeyFromPath, navPath } from "./app/router";
import { useCatalog, useSession, useWallet } from "./features/session/useSession";
import { useCreateGeneration, useGenerationJobs } from "./features/generation/useGeneration";
import { validateGenerationInput } from "./features/generation/validation";
import { CatalogProvider, toRuntimeFamilies } from "./features/catalog/CatalogProvider";
import { SystemState } from "./components/SystemState";
import { ApiError } from "./adapters/http/client";
import { useOnlineStatus } from "./lib/useOnlineStatus";
import { AppLoading } from "./components/AppLoading";

const Landing = lazy(() => import("./screens/Landing"));
const Studio = lazy(() => import("./screens/Studio"));
const StudioImage = lazy(() => import("./screens/StudioImage"));
const StudioAudio = lazy(() => import("./screens/StudioAudio"));
const Explore = lazy(() => import("./screens/Explore"));
const Effects = lazy(() => import("./screens/Effects"));
const Academy = lazy(() => import("./screens/Academy"));
const Mcp = lazy(() => import("./screens/Mcp"));
const Community = lazy(() => import("./screens/Community"));
const Gallery = lazy(() => import("./screens/Gallery"));
const Plans = lazy(() => import("./screens/Plans"));
const Profile = lazy(() => import("./screens/Profile"));
const Admin = lazy(() => import("./screens/Admin"));
const Generate = lazy(() => import("./screens/Generate"));
const Result = lazy(() => import("./screens/Result"));

function isKnownProductPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/plans" ||
    pathname === "/profile" ||
    pathname === "/admin" ||
    pathname.startsWith("/generate/") ||
    pathname.startsWith("/result/") ||
    navKeyFromPath(pathname) !== null
  );
}

export default function App({
  onSignIn = () => {},
  onSignUp = () => {},
  onSignOut = () => {},
}: {
  onSignIn?: () => void;
  onSignUp?: () => void;
  onSignOut?: () => void;
}) {
  const location = useLocation();
  const routeNavigate = useNavigate();
  const online = useOnlineStatus();
  const tab = navKeyFromPath(location.pathname) ?? "video";
  const setTab = (next: NavKey) => routeNavigate(navPath(next));
  const [gens, setGens] = useState<Generation[]>(loadGenerations);

  const sessionQuery = useSession();
  const session = sessionQuery.data ?? { status: "loading" as const, host: "web" as const };
  const authedSession = session.status === "authed";
  const walletQuery = useWallet(authedSession);
  const catalogQuery = useCatalog(authedSession);
  const catalogFamilies = catalogQuery.data ? toRuntimeFamilies(catalogQuery.data.families) : [];
  const wallet = walletQuery.data ?? null;
  const createGeneration = useCreateGeneration();
  const generationPendingRef = useRef(false);
  const [operationError, setOperationError] = useState<Error | null>(null);

  useEffect(() => saveGenerations(gens), [gens]);
  useEffect(() => startKieRates(), []); // live KIE price table (cached 6h)

  const runningJobIds = useMemo(
    () => gens.flatMap((generation) => (generation.status === "running" && generation.jobId ? [generation.jobId] : [])),
    [gens],
  );
  const jobQueries = useGenerationJobs(runningJobIds);
  const jobStateKey = jobQueries.jobs.map((job) => `${job.id}:${job.status}:${job.progress ?? ""}`).join("|");
  useEffect(() => {
    if (!jobStateKey) return;
    const byId = new Map(jobQueries.jobs.map((job) => [job.id, job]));
    setGens((previous) =>
      previous.map((generation) => {
        const job = generation.jobId ? byId.get(generation.jobId) : undefined;
        if (!job) return generation;
        return { ...generation, status: job.status === "done" ? "done" : "running", progress: job.progress };
      }),
    );
  }, [jobQueries.jobs, jobStateKey]);

  const lastWorkspacePath = useRef(navPath("video"));
  useEffect(() => {
    if (navKeyFromPath(location.pathname)) lastWorkspacePath.current = location.pathname;
  }, [location.pathname]);
  const goBack = useCallback(() => {
    if (location.key === "default") routeNavigate(lastWorkspacePath.current, { replace: true });
    else routeNavigate(-1);
  }, [location.key, routeNavigate]);

  const fullScreenRoute =
    location.pathname === "/plans" ||
    location.pathname === "/profile" ||
    location.pathname.startsWith("/generate/") ||
    location.pathname.startsWith("/result/");
  useSwipeBack(fullScreenRoute ? goBack : undefined);

  const openModel = (familyId: string, prompt?: string) => {
    const query = new URLSearchParams();
    if (prompt) query.set("prompt", prompt);
    routeNavigate(`/generate/${encodeURIComponent(familyId)}${query.size ? `?${query.toString()}` : ""}`);
  };
  const openWallet = () => routeNavigate("/plans");
  const markDone = (id: string) => setGens((p) => p.map((g) => (g.id === id ? { ...g, status: "done" } : g)));

  async function startGeneration(familyId: string, prompt: string, input: InputMap, variant: Variant, _refs: RefMap) {
    const family = catalogFamilies.find((candidate) => candidate.id === familyId);
    const catalogVariant = family?.variants.find((candidate) => candidate.id === variant.id);
    if (!family || !catalogVariant) return null;
    if (!validateGenerationInput({ family, variant, prompt, input, refs: _refs }).valid) return null;
    if (Object.values(_refs).some((files) => files.length > 0)) return null;
    if (generationPendingRef.current) return null;
    const aspect = currentAspect(variantControls(family, variant), input);
    // TODO(backend): POST each File in `refs` to /uploads and send the returned URLs
    // with the generate request, keyed by slot (image_url, first_frame_url, …).
    // `refs` deliberately stops here — Files aren't serialisable, so it can't go
    // into the persisted Generation, and there is no upload endpoint yet.
    generationPendingRef.current = true;
    try {
      const { job, quote } = await createGeneration.mutateAsync({
        quote: { familyId, variantId: variant.id, prompt, input, referenceAssetIds: {} },
        idempotencyKey: `vgen-${uid()}-${uid()}`,
      });
      const gen: Generation = {
        id: uid(),
        jobId: job.id,
        familyId: family.id,
        variantId: variant.id,
        name: family.name,
        vendor: family.vendor,
        grad: family.grad,
        kind: family.kind,
        prompt,
        w: aspect.w,
        h: aspect.h,
        status: "running",
        progress: job.progress ?? 0,
        createdAt: job.createdAt,
      };
      setGens((previous) => [gen, ...previous]);
      return { generation: gen, quote };
    } finally {
      generationPendingRef.current = false;
    }
  }

  async function regenerate(prev: Generation) {
    const family = catalogFamilies.find((candidate) => candidate.id === prev.familyId);
    const variant = family?.variants.find((candidate) => candidate.id === prev.variantId);
    if (!family || !variant) return;
    const started = await startGeneration(family.id, prev.prompt, defaultInput(variantControls(family, variant)), variant, {});
    if (!started) return;
    // replace-in-place: back from the new result returns to where the user
    // was before the previous result, not to a chain of stale results
    routeNavigate(`/result/${encodeURIComponent(started.generation.id)}`, { replace: true, state: { instant: false } });
  }

  // ---- signed-out and unknown ----
  // Three states, not two. `loading` is a real frame the moment sign-in involves
  // a network round trip, and painting "signed out" during it flashes a landing
  // page at someone who is in fact signed in. The app had no concept of any of
  // this: it rendered Home unconditionally and handed every screen a constant
  // balance, so a visitor with no identity got the full product.
  if (!online) {
    return <SystemState kind="offline" onPrimary={() => window.dispatchEvent(new Event(navigator.onLine ? "online" : "offline"))} />;
  }
  if (operationError) {
    return (
      <SystemState
        kind="service"
        title="ساخت شروع نشد"
        description="درخواست ساخت کامل نشد و اعتباری در این صفحه کسر نشده است. به فضای کار برگرد و دوباره تلاش کن."
        primaryLabel="بازگشت به فضای کار"
        onPrimary={() => setOperationError(null)}
        requestId={operationError instanceof ApiError ? operationError.requestId : undefined}
      />
    );
  }
  if (sessionQuery.error) {
    return (
      <SystemState
        kind="service"
        onPrimary={() => void sessionQuery.refetch()}
        requestId={sessionQuery.error instanceof ApiError ? sessionQuery.error.requestId : undefined}
        busy={sessionQuery.isFetching}
      />
    );
  }
  if (walletQuery.error) {
    return (
      <SystemState
        kind="service"
        title="کیف پول بارگذاری نشد"
        description="موجودی و اعتبارها دریافت نشدند. برای جلوگیری از نمایش عدد اشتباه، فضای ساخت تا دریافت دوباره کیف پول متوقف شده است."
        onPrimary={() => void walletQuery.refetch()}
        requestId={walletQuery.error instanceof ApiError ? walletQuery.error.requestId : undefined}
        busy={walletQuery.isFetching}
      />
    );
  }
  if (catalogQuery.error) {
    return (
      <SystemState
        kind="service"
        title="کاتالوگ مدل‌ها بارگذاری نشد"
        description="فهرست مدل‌ها و قیمت‌های منتشرشده در دسترس نیست. تا دریافت نسخه معتبر، امکان ساخت غیرفعال می‌ماند."
        onPrimary={() => void catalogQuery.refetch()}
        requestId={catalogQuery.error instanceof ApiError ? catalogQuery.error.requestId : undefined}
        busy={catalogQuery.isFetching}
      />
    );
  }
  if (jobQueries.error) {
    return (
      <SystemState
        kind="service"
        title="وضعیت خروجی‌ها به‌روز نشد"
        description="ارتباط با صف پردازش موقتاً قطع شده است. خود job حذف نشده؛ دوباره وضعیتش را دریافت کن."
        onPrimary={() => void jobQueries.retry()}
        requestId={jobQueries.error instanceof ApiError ? jobQueries.error.requestId : undefined}
        busy={jobQueries.isFetching}
      />
    );
  }
  if (session.status === "loading") {
    return <AppLoading label="در حال بررسی نشست کاربری…" />;
  }
  if (!isKnownProductPath(location.pathname)) {
    return <SystemState kind="not-found" onPrimary={() => routeNavigate(navPath("video"), { replace: true })} onSecondary={goBack} />;
  }
  if (session.status === "anonymous") {
    // Not wrapped in Shell: the landing page is the one surface that is
    // desktop-first and full-width, so it must not inherit the phone-shaped cap.
    return (
      <Suspense fallback={<ScreenFallback />}>
        <Landing onSignIn={onSignIn} onSignUp={onSignUp} />
      </Suspense>
    );
  }
  if (!wallet || !catalogQuery.data) return <AppLoading />;

  /* Everything below is signed in, so it all sits inside AccessProvider.
     The tier gate is asked five levels down — a picker row, a dock chip, a
     create button — and threading a plan id through Studio, FormPanel and every
     dock to reach them would put a billing parameter on components with no
     other interest in billing. See lib/access.

     `planId` is null because the backend cannot answer it yet, and null reads
     as tier 1, which is what a signup gift should buy. The day /me returns a
     plan, this one line is the only thing that changes. */
  const authed = () => {
    if (location.pathname === "/") return <Navigate to={navPath("video")} replace />;
    // ---- full-screen flows (no bottom nav) ----
    if (location.pathname === "/plans") {
      return (
        // Plans lays out its own 1100px container and turns its plan
        // rows into grids above `md`.
        <Shell>
          {/* currentPlanId stays null until the backend can answer it — the
            screen renders the honest not-subscribed state meanwhile. */}
          <Plans wallet={wallet} account={session.user} currentPlanId={null} onBack={goBack} />
        </Shell>
      );
    }
    if (location.pathname === "/profile") {
      return (
        // Profile lays out its own 900px two-column grid above `md`.
        <Shell>
          <Profile
            account={session.user}
            wallet={wallet}
            gens={gens}
            onWallet={openWallet}
            onGallery={goBack}
            onOpenModel={openModel}
            onSignOut={onSignOut}
          />
        </Shell>
      );
    }
    if (location.pathname === "/admin") {
      /* Not in the top bar, and that is deliberate — it is staff furniture, and
         a nav item for it would sit in front of every customer forever to save
         four people one bookmark. Reached by typing /admin. Once admin auth
         exists this route checks it; today it is unauthenticated, which is safe
         only because every write lands in the operator's own localStorage. */
      return (
        <Shell>
          <Admin onBack={goBack} />
        </Shell>
      );
    }
    const generateRoute = matchPath("/generate/:familyId", location.pathname);
    if (generateRoute) {
      const family = catalogFamilies.find((candidate) => candidate.id === decodeURIComponent(generateRoute.params.familyId ?? ""));
      if (!family) return <Navigate to={navPath("video")} replace />;
      const initialPrompt = new URLSearchParams(location.search).get("prompt") ?? undefined;
      return (
        // Generate lays out its own 1100px two-column grid above `md`.
        <Shell>
          <Generate
            family={family}
            initialPrompt={initialPrompt}
            onBack={goBack}
            onGenerate={async (prompt, input, variant, refs) => {
              const started = await startGeneration(family.id, prompt, input, variant, refs);
              return started ? { coins: started.quote.coins, expiresAt: started.quote.expiresAt } : null;
            }}
          />
        </Shell>
      );
    }
    const resultRoute = matchPath("/result/:generationId", location.pathname);
    if (resultRoute) {
      const gen = gens.find((generation) => generation.id === decodeURIComponent(resultRoute.params.generationId ?? ""));
      if (!gen) return <Navigate to="/gallery" replace />;
      const instant = Boolean((location.state as { instant?: boolean } | null)?.instant);
      return (
        // Result puts the media beside its actions above `md`.
        <Shell>
          <Result
            key={gen.id}
            gen={gen}
            instant={instant}
            onBack={goBack}
            onRegenerate={() =>
              void regenerate(gen).catch((error: unknown) => setOperationError(error instanceof Error ? error : new Error(String(error))))
            }
            onToVideo={() => openModel("seedance")}
            onDone={() => markDone(gen.id)}
          />
        </Shell>
      );
    }

    // ---- the nav'd area ----
    // No sidebar and no bottom tab bar: one 44px row carries every destination,
    // and the same row serves phone and desktop. See components/TopBar.
    return (
      <Shell>
        <TopBar active={tab} onNav={setTab} coins={wallet.spendable} onWallet={openWallet} onProfile={() => routeNavigate("/profile")} />
        {/* No AnimatePresence and no exit animation on the tab area.
          `mode="wait"` holds the outgoing screen mounted until its exit
          animation reports completion, and that report rides on
          requestAnimationFrame — which the browser throttles to nothing in a
          backgrounded or non-compositing tab. The next screen then never
          mounts and the app looks frozen on the old one. A keyed enter-only
          fade gives the same read with nothing to wait on. */}
        <div key={tab}>
          <motion.div initial={pageFade.initial} animate={pageFade.animate} transition={pageFade.transition}>
            {/* One screen per modality, not one screen parameterised by modality.
              The reference gives image, video and audio genuinely different
              architectures — a full-bleed wall under a floating glass dock, a
              320px side panel, and an icon rail over waveform cards — because
              the three kinds of output are shaped differently. They share the
              token layer and `useCreateState`, and nothing else. */}
            {tab === "video" && (
              <Studio
                kind="video"
                gens={gens}
                onGenerate={(family, variant, prompt, input) => {
                  void startGeneration(family.id, prompt, input, variant, {}).catch((error: unknown) =>
                    setOperationError(error instanceof Error ? error : new Error(String(error))),
                  );
                }}
                onOpen={(g) => routeNavigate(`/result/${encodeURIComponent(g.id)}`, { state: { instant: true } })}
              />
            )}
            {tab === "image" && (
              <StudioImage
                gens={gens}
                onGenerate={(family, variant, prompt, input) => {
                  void startGeneration(family.id, prompt, input, variant, {}).catch((error: unknown) =>
                    setOperationError(error instanceof Error ? error : new Error(String(error))),
                  );
                }}
                onOpenModel={openModel}
              />
            )}
            {tab === "audio" && (
              <StudioAudio
                gens={gens}
                onGenerate={(family, variant, prompt, input) => {
                  void startGeneration(family.id, prompt, input, variant, {}).catch((error: unknown) =>
                    setOperationError(error instanceof Error ? error : new Error(String(error))),
                  );
                }}
              />
            )}
            {tab === "explore" && <Explore onOpen={openModel} onNav={setTab} onWallet={openWallet} />}
            {tab === "effects" && <Effects onOpen={openModel} />}
            {tab === "academy" && <Academy onOpenModel={openModel} />}
            {tab === "mcp" && <Mcp onOpenModel={openModel} />}
            {tab === "community" && <Community onOpen={openModel} />}
            {tab === "gallery" && (
              <Gallery
                gens={gens}
                onOpen={(g) => routeNavigate(`/result/${encodeURIComponent(g.id)}`, { state: { instant: true } })}
                onBrowse={() => setTab("video")}
              />
            )}
          </motion.div>
        </div>
      </Shell>
    );
  };

  return (
    <AccessProvider planId={null} onUpgrade={openWallet}>
      <CatalogProvider families={catalogQuery.data.families}>
        <Suspense fallback={<ScreenFallback />}>{authed()}</Suspense>
      </CatalogProvider>
    </AccessProvider>
  );
}

function ScreenFallback() {
  return <AppLoading label="در حال بارگذاری صفحه…" />;
}

/**
 * The frame every screen sits in.
 *
 * `cap` holds the legacy 480px phone column. The full-screen flows — generate,
 * result, plans, models, profile — were drawn against that width and still read
 * as a phone layout stretched if it is removed, so they keep it until each is
 * rebuilt against the new shell. The nav'd area passes `cap={false}`: its
 * screens set their own width, and the top bar has to span the viewport for the
 * layout to read as a desktop app at all.
 */
/**
 * The frame every screen sits in — now just a background.
 *
 * It used to carry a 480px cap and the Ambient blobs, both inherited from the
 * phone-shaped app this grew out of. Every screen now lays out its own
 * container, so the last `cap` call site rendered nothing and the prop was
 * vestigial. Ambient went with it: drifting orange blobs read as depth behind a
 * 480px card and as a smudge behind a full-width tool.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return <div className="relative min-h-[100dvh] w-full bg-surface">{children}</div>;
}
