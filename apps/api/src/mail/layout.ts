/**
 * The shape every mail from DEEV has, so that they look like one product and
 * like the site they lead to.
 *
 * **Why this is a shared file and not a copied block.** The button is fifteen
 * lines of nested table markup with two colours that have to match the site's
 * tokens. Copied into a second mail it drifts on the first change; here it
 * drifts nowhere. Everything else about a mail — its words — stays in the file
 * that sends it.
 *
 * Inline styles only: mail clients drop `<style>` blocks. `dir="rtl"` on the
 * body rather than a wrapper, because Outlook ignores direction on a nested
 * div. Colours are the design tokens: `--vg-canvas` #0a0c0d, `--vg-primary`
 * #c6f52e, `--vg-text` #f4f5f7, `--vg-text-muted` #9fa4ad, `--vg-text-faint`
 * #8c919b.
 */

/** The code is ours and the link is built by us, but neither is a reason to
    interpolate unescaped into markup. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

/**
 * The door, wearing the face it wears on the site: a dark pill with a lit lime
 * edge, not a lime slab with dark type.
 *
 * What turns around that edge in a browser is a conic gradient on an
 * animation, and a mail client has neither — so it is frozen at the angle the
 * button rests at. Nested tables because Outlook renders with Word, where
 * padding and radius on an `<a>` are ignored, so the padding belongs to a
 * `<td>`. The lit edge is a 1px gradient cell with the dark fill inside it,
 * and the `bgcolor` behind the gradient is the same lime — so where the
 * gradient is dropped the edge survives as a flat ring instead of vanishing.
 */
export function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border-collapse:separate;">
        <tr>
          <td bgcolor="#c6f52e" style="padding:1px;border-radius:999px;background:#c6f52e;background-image:linear-gradient(100deg,rgba(198,245,46,0.35),#c6f52e 38%,#eaffb0 50%,#c6f52e 62%,rgba(198,245,46,0.3));box-shadow:0 0 44px rgba(198,245,46,0.24);">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;">
              <tr>
                <td align="center" bgcolor="#0a0c0d" style="border-radius:999px;background:#0a0c0d;">
                  <a href="${escapeHtml(href)}" style="display:block;padding:14px 22px;border-radius:999px;color:#f4f5f7;font-family:Tahoma,Arial,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;">
                    ${escapeHtml(label)}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>`;
}

/** A value set apart from the prose — an invite code, and nothing else so far. */
export function emailCallout(label: string, value: string): string {
  return `<p style="margin:0 0 6px;font-size:12px;color:#8c919b;">${escapeHtml(label)}</p>
      <p dir="ltr" style="margin:0 0 20px;font-size:22px;font-weight:bold;letter-spacing:2px;color:#c6f52e;font-family:monospace;">
        ${escapeHtml(value)}
      </p>`;
}

/**
 * The page the words sit on. `blocks` are pre-built markup — a button, a
 * callout — dropped between the lead and the notes in the order given.
 */
export function emailShell(parts: { heading: string; lead: string; blocks?: string[]; notes: string[] }): string {
  const blocks = (parts.blocks ?? []).join("\n      ");
  const notes = parts.notes
    .map(
      (note, index) =>
        `<p style="margin:0 0 ${index === parts.notes.length - 1 ? "0" : "6px"};font-size:12px;line-height:1.9;color:#8c919b;">
        ${escapeHtml(note)}
      </p>`,
    )
    .join("\n      ");

  return `<!doctype html>
<html lang="fa" dir="rtl">
  <body dir="rtl" style="margin:0;padding:24px;background:#0a0c0d;color:#f4f5f7;font-family:Tahoma,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;">
      <h1 style="margin:0 0 8px;font-size:20px;color:#f4f5f7;">${escapeHtml(parts.heading)}</h1>
      <p style="margin:0 0 20px;font-size:14px;line-height:1.9;color:#9fa4ad;">
        ${escapeHtml(parts.lead)}
      </p>
      ${blocks}
      ${notes}
    </div>
  </body>
</html>`;
}

/** Trailing slashes folded once, here, rather than at each call site. */
export function linkTo(webOrigin: string, path: string): string {
  return `${webOrigin.replace(/\/+$/, "")}${path}`;
}
