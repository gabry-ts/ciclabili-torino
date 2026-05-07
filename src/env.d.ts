/// <reference path="../.astro/types.d.ts" />

interface ImportMetaEnv {
  readonly PUBLIC_API_BASE: string;
  readonly PUBLIC_ORG_ID: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
