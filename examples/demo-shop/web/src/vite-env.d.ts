interface ImportMetaEnv {
  /** The client-side key of the Flagsmith environment the shop reads its flags from. */
  readonly VITE_FLAGSMITH_ENVIRONMENT_ID: string;
  /** The Flagsmith API. Defaults to a self-hosted Flagsmith on this machine. */
  readonly VITE_FLAGSMITH_API_URL?: string;
}
