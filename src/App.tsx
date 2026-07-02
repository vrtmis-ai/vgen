import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getFamily, variantControls, type Variant } from "./data/models";
import type { InputMap } from "./components/controls";
import { type Generation, loadGenerations, saveGenerations, uid } from "./lib/gallery";
import { Ambient, BottomNav, Logo, type NavKey } from "./components/chrome";
import Home from "./screens/Home";
import Models from "./screens/Models";
import Community from "./screens/Community";
import Gallery from "./screens/Gallery";
import Wallet from "./screens/Wallet";
import Generate, { currentAspect } from "./screens/Generate";
import Result from "./screens/Result";

const DEMO_COINS = 1250;

type Flow =
  | { s: "none" }
  | { s: "wallet" }
  | { s: "generate"; familyId: string; prompt?: string }
  | { s: "result"; gen: Generation; instant: boolean };

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const },
};

function Placeholder({ title }: { title: string }) {
  return (
    <div className="relative z-10 flex min-h-[70dvh] flex-col items-center justify-center gap-4 px-8 text-center">
      <div className="text-ink3 opacity-50">
        <Logo size={44} />
      </div>
      <div className="text-[15px] font-medium">{title}</div>
      <div className="text-[12.5px] text-ink3">این بخش به‌زودی فعال می‌شود</div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<NavKey>("home");
  const [flow, setFlow] = useState<Flow>({ s: "none" });
  const [gens, setGens] = useState<Generation[]>(loadGenerations);

  useEffect(() => saveGenerations(gens), [gens]);

  const openModel = (familyId: string, prompt?: string) => setFlow({ s: "generate", familyId, prompt });
  const openWallet = () => setFlow({ s: "wallet" });
  const goHome = () => setFlow({ s: "none" });
  const markDone = (id: string) => setGens((p) => p.map((g) => (g.id === id ? { ...g, status: "done" } : g)));

  function startGeneration(familyId: string, prompt: string, input: InputMap, variant: Variant) {
    const family = getFamily(familyId);
    if (!family) return;
    const aspect = currentAspect(variantControls(family, variant), input);
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
    setFlow({ s: "result", gen, instant: false });
  }

  function regenerate(prev: Generation) {
    const gen: Generation = { ...prev, id: uid(), status: "running", createdAt: Date.now() };
    setGens((p) => [gen, ...p]);
    setFlow({ s: "result", gen, instant: false });
  }

  if (flow.s === "wallet") {
    return (
      <Shell>
        <Wallet coins={DEMO_COINS} onBack={goHome} />
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
          onBack={goHome}
          onGenerate={(prompt, input, variant) => startGeneration(family.id, prompt, input, variant)}
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
          onBack={goHome}
          onRegenerate={() => regenerate(gen)}
          onToVideo={() => openModel("seedance")}
          onDone={() => markDone(gen.id)}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="pb-28">
        <AnimatePresence mode="wait">
          <motion.div key={tab} {...fade}>
            {tab === "home" && <Home coins={DEMO_COINS} onOpen={openModel} onAllModels={() => setTab("models")} onWallet={openWallet} />}
            {tab === "models" && <Models coins={DEMO_COINS} onOpen={openModel} onWallet={openWallet} />}
            {tab === "community" && <Community coins={DEMO_COINS} onOpen={openModel} onWallet={openWallet} />}
            {tab === "gallery" && (
              <Gallery
                gens={gens}
                coins={DEMO_COINS}
                onOpen={(g) => setFlow({ s: "result", gen: { ...g, status: "done" }, instant: true })}
                onBrowse={() => setTab("models")}
                onWallet={openWallet}
              />
            )}
            {tab === "profile" && <Placeholder title="پروفایل" />}
          </motion.div>
        </AnimatePresence>
      </div>
      <BottomNav active={tab} onNav={setTab} />
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
