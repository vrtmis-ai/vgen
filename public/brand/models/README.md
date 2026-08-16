# Model marks

The landing hero names nine models. Each one shows its vendor monogram until we
ship that model's own mark, which takes **two** steps — the file, and the
permission:

1. Drop square SVG artwork here, named after the family id: `veo.svg`.
2. Add that same id to `SHIPPED_MARKS` in `src/components/ModelMark.tsx`.

Step 2 is not bookkeeping. It is the reason the row does not simply probe for
files: deriving "do we have artwork?" from a 404 makes the landing page open by
firing a failed request per model, and it makes shipping someone else's
trademark a side effect of copying a file into `public/`. The list is where a
person says they checked.

The nine the hero asks for, in the order it shows them:

| file | model | vendor |
| --- | --- | --- |
| `veo.svg` | Veo 3.1 | Google |
| `kling.svg` | Kling | Kuaishou |
| `seedance.svg` | Seedance | ByteDance |
| `wan.svg` | Wan | Alibaba |
| `minimax-h3.svg` | MiniMax H3 | MiniMax |
| `nano-banana.svg` | Nano Banana | Google |
| `gpt-image.svg` | GPT Image | OpenAI |
| `gemini-omni.svg` | Gemini Omni | Google |
| `elevenlabs.svg` | ElevenLabs | ElevenLabs |

Square artwork, drawn to the full box — they render at 16px, so anything with
built-in padding will look smaller than its neighbours.

The three Google rows are why this component exists at all: as monograms they
are three identical blue `G`s, which reads as one company rather than as a
catalogue. Those are the three worth sourcing first.

One caution, and it is the reason `VendorMark` exists: these are other
companies' trademarks. Adding an id to `SHIPPED_MARKS` asserts that this
particular brand's guidelines allow its mark to be used to indicate
compatibility. That is a per-brand check, not a blanket one.
