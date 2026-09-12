export interface Env {
  /** Static client files (dist/client), served asset-first. */
  ASSETS: Fetcher;
  /** One Durable Object instance per room; the instance named "__lobby" is the zone registry. */
  ROOMS: DurableObjectNamespace;
  HF_ENV?: string;
  APP_SLUG?: string;
}
