export type PublicReleaseStatus = "development" | "beta" | "stable";

export interface PublicReleaseConfig {
  status: PublicReleaseStatus;
  version: string;
  supportedIosBuilds: string[];
  billingEnabled: boolean;
  monthlyPriceLabel: string;
  yearlyPriceLabel: string;
  downloads: {
    macosArm64?: string;
    macosX64?: string;
    windowsX64?: string;
  };
}

export function getPublicReleaseConfig(env: Env): PublicReleaseConfig {
  const status = isReleaseStatus(env.PUBLIC_RELEASE_STATUS)
    ? env.PUBLIC_RELEASE_STATUS
    : "development";
  return {
    status,
    version: validVersion(env.PUBLIC_RELEASE_VERSION) ? env.PUBLIC_RELEASE_VERSION : "0.0.0",
    supportedIosBuilds: (env.PUBLIC_SUPPORTED_IOS_BUILDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 20),
    billingEnabled: env.PUBLIC_BILLING_ENABLED === "true",
    monthlyPriceLabel: safeLabel(env.PUBLIC_MONTHLY_PRICE_LABEL, "Not configured"),
    yearlyPriceLabel: safeLabel(env.PUBLIC_YEARLY_PRICE_LABEL, "Not configured"),
    downloads: {
      ...(safeDownloadUrl(env.PUBLIC_MACOS_ARM64_DOWNLOAD_URL)
        ? { macosArm64: env.PUBLIC_MACOS_ARM64_DOWNLOAD_URL }
        : {}),
      ...(safeDownloadUrl(env.PUBLIC_MACOS_X64_DOWNLOAD_URL)
        ? { macosX64: env.PUBLIC_MACOS_X64_DOWNLOAD_URL }
        : {}),
      ...(safeDownloadUrl(env.PUBLIC_WINDOWS_X64_DOWNLOAD_URL)
        ? { windowsX64: env.PUBLIC_WINDOWS_X64_DOWNLOAD_URL }
        : {}),
    },
  };
}

export function publicReleaseReady(config: PublicReleaseConfig): boolean {
  return (
    config.status === "stable" &&
    config.version !== "0.0.0" &&
    config.supportedIosBuilds.length > 0 &&
    Boolean(config.downloads.macosArm64) &&
    Boolean(config.downloads.macosX64) &&
    Boolean(config.downloads.windowsX64) &&
    config.billingEnabled
  );
}

function isReleaseStatus(value: string | undefined): value is PublicReleaseStatus {
  return value === "development" || value === "beta" || value === "stable";
}

function validVersion(value: string | undefined): value is string {
  return Boolean(value && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value));
}

function safeDownloadUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "releases.enigma.example" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function safeLabel(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length <= 40 ? normalized : fallback;
}
