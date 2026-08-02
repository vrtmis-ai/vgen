import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getFamily, variantControls, type Variant, type ModelKind } from "./data/models";
import type { InputMap, RefMap } from "./components/controls";
import { type Generation, loadGenerations, saveGenerations, uid } from "./lib/gallery";
import { startKieRates } from "./lib/kieRates";
import { useSwipeBack } from "./lib/useSwipeBack";
import { pageFade } from "./lib/motion";
import { FEATURED } from "./data/featured";
import { Ambient, BottomNav, type NavKey } from "./components/chrome";
import { CreateSheet } from "./components/CreateSheet";
import Home from "./screens/Home";
import Models from "./screens/Models";
import Community from "./screens/Community";
import Gallery from "./screens/Gallery";
import Plans from "./screens/Plans";
import Profile from "./screens/Profile";
import Generate, { currentAspect } from "./screens/Generate";
import Result from "./screens/Result";

const DEMO_COINS = 1250;
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

  // ---- full-screen flows (no bottom nav) ----
  if (flow.s === "wallet") {
    return (
      <Shell>
        {/* currentPlanId stays null until the backend can answer it — the
            screen renders the honest not-subscribed state meanwhile. */}
        <Plans coins={DEMO_COINS} currentPlanId={null} onBack={goBack} />
      </Shell>
    );
  }
  if (flow.s === "models") {
    return (
      <Shell>
        <Models coins={DEMO_COINS} initialKind={flow.kind} onOpen={openModel} onWallet={openWallet} onBack={goBack} />
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
    <Shell>
      <div className="pb-28">
        <AnimatePresence mode="wait">
          <motion.div key={tab} {...pageFade}>
            {tab === "home" && (
              <Home coins={DEMO_COINS} onOpen={openModel} onModels={openModels} onCommunity={() => setTab("community")} onWallet={openWallet} onCreate={() => setCreateOpen(true)} />
            )}
            {tab === "community" && <Community coins={DEMO_COINS} onOpen={openModel} onWallet={openWallet} />}
            {tab === "gallery" && (
              <Gallery
                gens={gens}
                coins={DEMO_COINS}
                onOpen={(g) => navigate({ s: "result", gen: { ...g, status: "done" }, instant: true })}
                onBrowse={() => openModels()}
                onWallet={openWallet}
              />
            )}
            {tab === "profile" && (
              <Profile coins={DEMO_COINS} gens={gens} onWallet={openWallet} onGallery={() => setTab("gallery")} onOpenModel={openModel} />
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative mx-auto min-h-[100dvh] max-w-[480px] overflow-hidden bg-surface">
      <Ambient />
      {children}
    </div>
  );
}
