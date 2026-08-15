/**
 * Sending an OTP.
 *
 * A port, because the gateway is the part of auth most likely to change: an
 * Iranian sender (Kavenegar, SMS.ir, Ghasedak) needs a domestic account, and
 * which one is a commercial decision that should not reach into the signup
 * flow. Everything above this interface only knows that a code was handed to
 * something that sends it.
 */
export interface SmsSender {
  sendVerificationCode(phoneE164: string, code: string): Promise<void>;
}

/**
 * Development sender: prints the code instead of sending it.
 *
 * Refuses to run in production. Without that guard, a missing gateway
 * configuration would not fail the deploy — it would silently start printing
 * every customer's one-time code into the logs while signup appeared to work.
 */
export class ConsoleSmsSender implements SmsSender {
  constructor(private readonly log: (line: string) => void = console.info) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ConsoleSmsSender must not be used in production; configure a real SMS gateway");
    }
  }

  async sendVerificationCode(phoneE164: string, code: string): Promise<void> {
    this.log(`[sms] verification code for ${phoneE164}: ${code}`);
  }
}

export interface KavenegarConfig {
  apiKey: string;
  /** The pre-approved template name. Iranian gateways send OTPs via template, not free text. */
  template: string;
  fetchImpl?: typeof fetch;
}

/**
 * Kavenegar's verify/lookup endpoint.
 *
 * OTPs go through the template API rather than plain SMS because that is the
 * route that is allowed to deliver to numbers which have opted out of
 * advertising, and it is the one that is not rate-limited as bulk traffic.
 *
 * Untested against the live service — it needs a domestic account — so treat
 * the first real send as the test.
 */
export class KavenegarSmsSender implements SmsSender {
  constructor(private readonly config: KavenegarConfig) {}

  async sendVerificationCode(phoneE164: string, code: string): Promise<void> {
    // The gateway wants a local 09… number, not E.164.
    const receptor = phoneE164.replace(/^\+98/, "0");
    const url = new URL(`https://api.kavenegar.com/v1/${this.config.apiKey}/verify/lookup.json`);
    url.searchParams.set("receptor", receptor);
    url.searchParams.set("token", code);
    url.searchParams.set("template", this.config.template);

    const send = this.config.fetchImpl ?? fetch;
    const response = await send(url, { method: "GET", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      // The body can contain the account's own details, so it is not surfaced.
      throw new Error(`SMS gateway rejected the request with ${response.status}`);
    }
  }
}
