import type { AppServices } from "../../app/AppServices";
import type { AccountUser } from "../../app/contracts/session";

const DEMO_USER: AccountUser = {
  id: "demo-user",
  methods: ["email"],
  emailNormalized: "demo@vgen.local",
  displayName: "کاربر نمونه",
  locale: "fa",
};

export function createDemoSessionService(): AppServices["session"] {
  return {
    async getCurrent() {
      return {
        status: "authed",
        host: "web",
        user: DEMO_USER,
      };
    },
  };
}
