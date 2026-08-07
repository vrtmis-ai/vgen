import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getFamily, variantControls, type Variant, type ModelKind } from "./data/models";
import type { InputMap, RefMap } from "./components/controls";
import { type Generation, loadGenerations, saveGenerations, uid } from "./lib/gallery";
import { startKieRates } from "./lib/kieRates";
import { useSwipeBack } from "./lib/useSwipeBack";
import { pageFade } from "./lib/motion";
import { Ambient } from "./components/chrome";
import { TopBar, type NavKey } from "./components/TopBar";
import Landing from "./screens/Landing";
import Models from "./screens/Models";
import Studio from "./screens/Studio";
import Explore from "./screens/Explore";
import Gallery from "./screens/Gallery";
import Plans from "./screens/Plans";
import Profile from "./screens/Profile";
import Generate, { currentAspect } from "./screens/Generate";
import Result from "./screens/Result";
import { useSession } from "./lib/session";
import { demoWallet } from "./data/wallet";

/** The nav is modality-first, so three of its five keys map straight onto a
 *  catalog kind. The other two are surfaces, not kinds. */
const STUDIO_KIND: Partial<Record<NavKey, ModelKind>> = { image: "image", video: "video", audio: "audio" };

type Flow =
  | { s: "none" }
  | { s: "wallet" }
  | { s: "profile" }
  | { s: "models"; kind: ModelKind }
  // `| undefined` on an optional field is not redundant under
  // exactOptionalPropertyTypes: it is the difference between "the key may be
  // absent" and "the key may be present holding undefined". openModel passes an
  // optional argument straight through, so this one is genuinely the latter.
  | { s: "generate"; familyId: string; prompt?: string | undefined }
  | { s: "result"; gen: Generation; instant: boolean };

export default function App() {
  const [tab, setTab] = useState<NavKey>("video");
  const [flow, setFlow] = useState<Flow>({ s: "none" });
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
  if (flow.s === "profile") {
    return (
      <Shell>
        <Profile wallet={wallet} gens={gens} onWallet={openWallet} onGallery={goBack} onOpenModel={openModel} />
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

  // ---- the nav'd area ----
  // No sidebar and no bottom tab bar: one 44px row carries every destination,
  // and the same row serves phone and desktop. See components/TopBar.
  const studioKind = STUDIO_KIND[tab];
  return (
    <Shell cap={false}>
      <TopBar
        active={tab}
        onNav={setTab}
        coins={wallet.spendable}
        onWallet={openWallet}
        onProfile={() => navigate({ s: "profile" })}
      />
      <AnimatePresence mode="wait">
        <motion.div key={tab} {...pageFade}>
          {studioKind && (
            <Studio
              kind={studioKind}
              gens={gens}
              onGenerate={(family, variant, prompt, input) => startGeneration(family.id, prompt, input, variant, {})}
              onOpen={(g) => navigate({ s: "result", gen: { ...g, status: "done" }, instant: true })}
            />
          )}
          {tab === "explore" && <Explore onOpen={openModel} onNav={setTab} onWallet={openWallet} />}
          {tab === "gallery" && (
            <Gallery
              gens={gens}
              wallet={wallet}
              onOpen={(g) => navigate({ s: "result", gen: { ...g, status: "done" }, instant: true })}
              onBrowse={() => openModels()}
              onWallet={openWallet}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </Shell>
  );
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
function Shell({ children, cap = true }: { children: React.ReactNode; cap?: boolean }) {
  return (
    <div className="relative min-h-[100dvh] bg-surface">
      {/* Ambient rides with the capped phone column only. Its drifting orange
          blobs read as depth behind a 480px card; behind a full-width tool they
          read as a smudge, and they are the single most off-register thing
          against a reference whose background is flat to the pixel. */}
      {cap && <Ambient />}
      <div className={`relative min-h-[100dvh] w-full ${cap ? "mx-auto max-w-[480px] overflow-hidden" : ""}`}>
        {children}
      </div>
    </div>
  );
}
