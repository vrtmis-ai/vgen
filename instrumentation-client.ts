import { startAnalytics } from "./src/lib/analytics";

// Runs before hydration. All of the logic, and the consent gate, is in analytics.ts.
startAnalytics();
