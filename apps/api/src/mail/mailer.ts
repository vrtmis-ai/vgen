import { createTransport, type Transporter } from "nodemailer";

/**
 * Sending mail as DEEV.
 *
 * **An SMTP client, not a mail server.** The domain's mail lives on a cPanel
 * host that is not this machine — `mail.deevapp.com`, a different IP from the
 * app — and this authenticates to it on the submission port like any desktop
 * client would. Running an MTA here instead would need its own PTR record from
 * the hosting provider, start from zero sending reputation with Gmail, and put
 * two senders on one domain with SPF and DKIM to maintain in both. None of
 * that buys anything the submission port does not already give.
 *
 * **Optional, like the SMS sender.** With no credentials configured there is
 * no transport, and the one route that sends mail says so plainly rather than
 * reporting a success nobody received. That is what lets this land before the
 * mailbox is wired up, and what keeps local development from needing one.
 */
export interface Mailer {
  send(message: { to: string; subject: string; text: string; html: string }): Promise<void>;
}

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  /** What recipients see in From. The address must be one the server may send as. */
  from: string;
}

/**
 * Reads the settings from the environment, or returns null when they are not
 * all there.
 *
 * All five or none: a half-configured transport is a runtime failure on the
 * first send, which is the worst moment to discover it. The password is only
 * ever read from here — it is not a build argument, not a default, and not
 * something any caller passes in.
 */
export function smtpSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpSettings | null {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const password = env.SMTP_PASSWORD;
  const from = env.MAIL_FROM?.trim() ?? (user ? `DEEV <${user}>` : undefined);
  const port = Number(env.SMTP_PORT?.trim() || 587);

  if (!host || !user || !password || !from || !Number.isInteger(port)) return null;
  return { host, port, user, password, from };
}

export function createMailer(settings: SmtpSettings): Mailer {
  /* `secure: false` with port 587 is STARTTLS, not plaintext: nodemailer
     upgrades the connection before it authenticates, and `requireTLS` makes
     that upgrade mandatory rather than opportunistic — without it a server
     that fails to offer STARTTLS would get the password in the clear. 465 is
     implicit TLS from the first byte, so it takes the other branch. */
  const transport: Transporter = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.port === 465,
    requireTLS: settings.port !== 465,
    auth: { user: settings.user, pass: settings.password },
  });

  return {
    async send(message) {
      await transport.sendMail({
        from: settings.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}
