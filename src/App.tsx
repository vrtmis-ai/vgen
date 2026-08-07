import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getFamily, variantControls, type Variant, type ModelKind } from "./data/models";
import type { InputMap, RefMap } from "./components/controls";
import { type Generation, loadGenerations, saveGenerations, uid } from "./lib/gallery";
import { startKieRates } from "./lib/kieRates";
import { useSwipeBack } from "./lib/useSwipeBack";
import { pageFade } from "./lib/motion";
import { FEATURED } from "./data/featured";
import { Ambient, BottomNav, SideNav, type NavKey } from "./components/chrome";
import { CreateSheet } from "./components/CreateSheet";
import Landing from "./screens/Landing";
import Home from "./screens/Home";
import { minCoinsForFamily } from "./data/pricing";
import Models from "./screens/Models";
import Community from "./screens/Community";
import Gallery from "./screens/Gallery";
import Plans from "./screens/Plans";
import Profile from "./screens/Profile";
import Generate, { currentAspect } from "./screens/Generate";
import Result from "./screens/Result";
import { useSession } from "./lib/session";
import { demoWallet } from "./data/wallet";

const TEMPLATE = FEATURED.find((f) => f.kind === "template");

type Flow =
  | { s: "none" }
  | { s: "wallet" }
  | { s: "models"; kind: ModelKind }
  // `| undefined` on an optional field is not redundant under
  // exactOptionalPropertyTypes: it is the difference between "the key may be
  // absent" and "the key may be present holding undefined". openModel passes an
  // optional argument straight through, so this one is genuinely the latter.
  | { s: "generate"; familyId: string; prompt?: string | undefined }
  | { s: "result"; gen: Generation; instant: boolean };

export default function App() {
  const [tab, setTab] = useState<NavKey>("home");
  const [flow, setFlow] = useState<Flow>({ s: "none" });
  const [createOpen, setCreateOpen] = useState(false);
  const [gens, setGens] = useState<Generation[]>(loadGenerations);

  const session = useSession();
  // Stand-in for GET /me. A wallet is grants, not a number — screens take the
  // whole thing so that when the balance becomes real they read `spendable` and
  // `nextExpiry` from the server instead of being rewired.
  const wallet = useMemo(() => demoWallet(), []);

  useEffect(() => saveGenerations(gens), [gens]);
  useEffect(() => startKieRates(), []); // live KIE price table (cached 6h)

  // ---- navigation: one source of truth for back ------------------------
  // Every sub-screen push adds a browser-history entry, so the on-screen
  // back button, the edge-swipe gesture, and the hardware/Telegram back
  // button all travel the same stack and land in the same place.
  const flowRef = useRef(flow);
  flowRef.current = flow;
  const stackRef = useRef<Flow[]>([]);

  const navigate = useCallback((f: Flow) => {
    stackRef.current.push(flowRef.current);
    setFlow(f);
    window.history.pushState({ vgen: stackRef.current.length }, "");
  }, []);

  const goBack = useCallback(() => {
    if (stackRef.current.length > 0) window.history.back();
    else setFlow({ s: "none" });
  }, []);

  useEffect(() => {
    const onPop = () => setFlow(stackRef.current.pop() ?? { s: "none" });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useSwipeBack(flow.s !== "none" ? goBack : undefined);

  const openModel = (familyId: string, prompt?: string) => navigate({ s: "generate", familyId, prompt });
  const openModels = (kind: ModelKind = "image") => navigate({ s: "models", kind });
  const openWallet = () => navigate({ s: "wallet" });
  const openTemplate = () => (TEMPLATE?.familyId ? openModel(TEMPLATE.familyId, TEMPLATE.prompt) : openModels());
  const markDone = (id: string) => setGens((p) => p.map((g) => (g.id === id ? { ...g, status: "done" } : g)));

  // `_refs` is deliberately unread — see the note below. Named with the
  // underscore so the unused-parameter check stays on for everything else.
  function startGeneration(familyId: string, prompt: string, input: InputMap, variant: Variant, _refs: RefMap) {
    const family = getFamily(familyId);
    if (!family) return;
    const aspect = currentAspect(variantControls(family, variant), input);
    // TODO(backend): POST each File in `refs` to /uploads and send the returned URLs
    // with the generate request, keyed by slot (image_url, first_frame_url, …).
    // `refs` deliberately stops here — Files aren't serialisable, so it can't go
    // into the persisted Generation, and there is no upload endpoint yet.
    const gen: Generation = {
      id: uid(),
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
      createdAt: Date.now(),
    };
    setGens((p) => [gen, ...p]);
    navigate({ s: "result", gen, instant: false });
  }

  function regenerate(prev: Generation) {
    const gen: Generation = { ...prev, id: uid(), status: "running", createdAt: Date.now() };
    setGens((p) => [gen, ...p]);
    // replace-in-place: back from the new result returns to where the user
    // was before the previous result, not to a chain of stale results
    setFlow({ s: "result", gen, instant: false });
  }

  // ---- signed-out and unknown ----
  // Three states, not two. `loading` is a real frame the moment sign-in involves
  // a network round trip, and painting "signed out" during it flashes a landing
  // page at someone who is in fact signed in. The app had no concept of any of
  // this: it rendered Home unconditionally and handed every screen a constant
  // balance, so a visitor with no identity got the full product.
  if (session.status === "loading") {
    return <Shell>{null}</Shell>;
  }
  if (session.status === "anonymous") {
    // Not wrapped in Shell: the landing page is the one surface that is
    // desktop-first and full-width, so it must not inherit the phone-shaped cap.
    // onSignIn is a no-op stub until /auth/google and /auth/phone exist — the
    // page is complete, the endpoints behind its buttons are not.
    return <Landing onSignIn={() => {}} />;
  }

  // ---- full-screen flows (no bottom nav) ----
  if (flow.s === "wallet") {
    return (
      <Shell>
        {/* currentPlanId stays null until the backend can answer it — the
            screen renders the honest not-subscribed state meanwhile. */}
        <Plans wallet={wallet} account={session.user} currentPlanId={null} onBack={goBack} />
      </Shell>
    );
  }
  if (flow.s === "models") {
    return (
      <Shell>
        <Models wallet={wallet} initialKind={flow.kind} onOpen={openModel} onWallet={openWallet} onBack={goBack} />
      </Shell>
    );
  }
  if (flow.s === "generate") {
    const family = getFamily(flow.familyId);
    if (!family) return null;
    return (
      <Shell>
        <Generate
          family={family}
          initialPrompt={flow.prompt}
          onBack={goBack}
          onGenerate={(prompt, input, variant, refs) => startGeneration(family.id, prompt, input, variant, refs)}
        />
      </Shell>
    );
  }
  if (flow.s === "result") {
    const gen = flow.gen;
    return (
      <Shell>
        <Result
          key={gen.id}
          gen={gen}
          instant={flow.instant}
          onBack={goBack}
          onRegenerate={() => regenerate(gen)}
          onToVideo={() => openModel("seedance")}
          onDone={() => markDone(gen.id)}
        />
      </Shell>
    );
  }

  // ---- tabbed area ----
  return (
    <Shell withNav>
      <SideNav active={tab} onNav={setTab} onCreate={() => setCreateOpen(true)} coins={wallet.spendable} onWallet={openWallet} />
      <div className="pb-28 md:pb-10">
        <AnimatePresence mode="wait">
          <motion.div key={tab} {...pageFade}>
            {tab === "home" && (
              <Home wallet={wallet} onOpen={openModel} onModels={openModels} onCommunity={() => setTab("community")} onWallet={openWallet} minPrice={minCoinsForFamily} />
            )}
            {tab === "community" && <Community wallet={wallet} onOpen={openModel} onWallet={openWallet} />}
            {tab === "gallery" && (
              <Gallery
                gens={gens}
                wallet={wallet}
                onOpen={(g) => navigate({ s: "result", gen: { ...g, status: "done" }, instant: true })}
                onBrowse={() => openModels()}
                onWallet={openWallet}
              />
            )}
            {tab === "profile" && (
              <Profile wallet={wallet} gens={gens} onWallet={openWallet} onGallery={() => setTab("gallery")} onOpenModel={openModel} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <BottomNav active={tab} onNav={setTab} onCreate={() => setCreateOpen(true)} />
      <CreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onImage={() => openModels("image")}
        onVideo={() => openModels("video")}
        onTemplate={openTemplate}
        onAll={() => openModels()}
      />
    </Shell>
  );
}

/**
 * The frame every screen sits in.
 *
 * `max-w-[480px]` was a phone-shaped cap applied to every viewport, so a desktop
 * browser got a narrow column with dead gutters either side. It now only caps
 * below `md`; from there the sidebar takes 280px on the inline start and the
 * content fills what is left, up to the system's 1440px container.
 *
 * `withNav` is false for the full-screen flows (generate, result, plans) — they
 * are their own context and the rail would only offer a way to lose the work.
 */
function Shell({ children, withNav = false }: { children: React.ReactNode; withNav?: boolean }) {
  return (
    <div className="relative min-h-[100dvh] bg-surface">
      <Ambient />
      <div
        className={`relative mx-auto min-h-[100dvh] w-full max-w-[480px] md:max-w-none ${withNav ? "md:ps-[var(--vg-sidebar-width)]" : ""}`}
      >
        <div className="mx-auto w-full md:max-w-[var(--vg-container-max)]">{children}</div>
      </div>
    </div>
  );
}
