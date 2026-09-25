import { describe, expect, it } from "vitest";
import { readDuration } from "./controls";

/* ---------------------------------------------------------------------------
   What the duration probe will point a media element at.

   `readDuration` builds an off-screen <video>/<audio> and assigns a URL to it
   to read the length of a clip. CodeQL flagged that assignment as high — alert
   #19, `js/xss-through-dom` — because a string arriving from anywhere becomes
   a live resource on the page.

   Our two callers pass a `blob:` made from a picked File, and an `http(s):`
   built by `mediaSrc` for a stored asset. Everything else resolves to a
   protocol that is not on the list, and the answer is "length unknown", which
   is what every caller already does with an unreadable file.
   --------------------------------------------------------------------------- */

describe("the duration probe", () => {
  it("says nothing for an image, without touching the DOM", async () => {
    await expect(readDuration("blob:whatever", "image")).resolves.toBeUndefined();
  });

  it("refuses a scheme it did not make", async () => {
    await expect(readDuration("javascript:alert(1)", "video")).resolves.toBeUndefined();
    await expect(readDuration("data:text/html,<script>1</script>", "video")).resolves.toBeUndefined();
  });

  it("refuses a string that is not a URL at all", async () => {
    await expect(readDuration("", "audio")).resolves.toBeUndefined();
  });
});
