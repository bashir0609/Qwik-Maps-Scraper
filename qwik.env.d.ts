// This file can be used to add references for global types like `vite/client`.

// Add global `vite/client` types. For more info, see: https://vitejs.dev/guide/features#client-types
/// <reference types="vite/client" />

// @qwik-city-plan is a virtual module generated at build time by the Qwik City Vite plugin.
// This declaration prevents editor errors before the build has run.
declare module "@qwik-city-plan" {
  const plan: import("@builder.io/qwik-city").QwikCityPlan;
  export default plan;
}

// Augment Vite's ImportMetaEnv with app-specific env vars.
// Vite/client already provides BASE_URL, MODE, DEV, PROD, etc.
interface ImportMetaEnv {
  readonly GOOGLE_PLACES_API_KEY: string;
}
