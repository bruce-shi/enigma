import { type PublicReleaseConfig, publicReleaseReady } from "./public-config.server";

export function buildHealthPayload(config: PublicReleaseConfig) {
  return {
    ok: true,
    service: "enigma-web",
    releaseStatus: config.status,
    releaseVersion: config.version,
    publicReleaseReady: publicReleaseReady(config),
    billingConfigured: config.billingEnabled,
    publishedArtifactCount: Object.keys(config.downloads).length,
  };
}
