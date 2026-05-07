// Runtime config sourced from env vars (PUBLIC_* are exposed to the browser).
// Override via .env or .env.local at the project root.

export const APP_CONFIG = {
  apiBase:
    import.meta.env.PUBLIC_API_BASE ||
    "https://www.eco-visio.net/api/aladdin/1.0.0/pbl/publicwebpageplus/",
  orgId: Number(import.meta.env.PUBLIC_ORG_ID || "6771"),
};

declare global {
  interface Window {
    APP_CONFIG: typeof APP_CONFIG;
  }
}

if (typeof window !== "undefined") {
  window.APP_CONFIG = APP_CONFIG;
}
