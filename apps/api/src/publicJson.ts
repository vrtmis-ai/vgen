import type { FastifyReply } from "fastify";

/**
 * Sends a document that is identical for every visitor without re-serialising
 * it on every request.
 *
 * A CPU profile of `/api/v1/content` under 100 concurrent readers found the
 * process pinned at 92% of one core, and the largest single cost in it was
 * `JSON.stringify` — 26% of all CPU, spent turning the *same* 24 KB object
 * into the *same* 24 KB of text several thousand times a second. `PublicDocument`
 * had already removed the query behind that object; nothing had removed the
 * serialisation in front of it. Caching the bytes was worth about 27% more
 * throughput and took a third off p99.
 *
 * **The cache key is the document's identity, not a fingerprint of its
 * contents.** `PublicDocument.get()` hands back the very same object until the
 * thing it is built from changes, and builds a fresh one when it does — so
 * `!==` is exactly the question "is this a different document than the one I
 * serialised?", answered without a second query, an expiry, or a key to get
 * wrong. It follows that the document must never be mutated in place; every
 * producer here rebuilds instead, which is what makes this sound.
 *
 * Fastify skips its own serialiser entirely for a Buffer payload
 * (`lib/reply.js`, the `payload.buffer instanceof ArrayBuffer` branch), and
 * takes Content-Length from the buffer rather than measuring UTF-8 length —
 * so the saving is the stringify plus the byte count plus the utf8 encode on
 * the way out. The response is byte-for-byte what the route sent before,
 * headers included.
 */
export function publicJson<T>(shape: (source: T) => unknown = (source) => source) {
  let cached: { source: T; body: Buffer } | null = null;

  return (reply: FastifyReply, source: T): FastifyReply => {
    if (cached?.source !== source) cached = { source, body: Buffer.from(JSON.stringify(shape(source))) };
    return reply.type("application/json; charset=utf-8").send(cached.body);
  };
}
