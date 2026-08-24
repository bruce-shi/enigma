import type { MetaDescriptor } from "react-router";

export const siteOrigin = "https://enigma.bruceshi.com";

export const defaultSeo = {
  title: "Enigma — iPhone GPS Location Changer for Apps & Games",
  description:
    "Change your iPhone GPS location, teleport anywhere, plan custom routes, replay GPX tracks, and move freely in location-based apps and games.",
  keywords:
    "iPhone location changer, GPS location changer, location-based games, GPS game location changer, GPX route simulator, GPS joystick",
};

export function createPageMeta({
  title,
  description,
  path,
  keywords,
}: {
  title: string;
  description: string;
  path: string;
  keywords?: string;
}): MetaDescriptor[] {
  const url = new URL(path, siteOrigin).toString();

  return [
    { title },
    { name: "description", content: description },
    ...(keywords ? [{ name: "keywords", content: keywords }] : []),
    {
      name: "robots",
      content: "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
    },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Enigma" },
    { property: "og:locale", content: "en_US" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { tagName: "link", rel: "canonical", href: url },
  ];
}

export function createErrorMeta(notFound = false): MetaDescriptor[] {
  return [
    { title: notFound ? "Page not found — Enigma" : "Enigma hit a problem" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export const homeStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${siteOrigin}/#website`,
      name: "Enigma",
      url: siteOrigin,
      description: defaultSeo.description,
      inLanguage: "en",
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${siteOrigin}/#software`,
      name: "Enigma",
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "macOS 12 or later",
      url: siteOrigin,
      downloadUrl: "https://github.com/bruce-shi/enigma/releases",
      sameAs: "https://github.com/bruce-shi/enigma",
      description:
        "An iPhone GPS location changer for custom routes, GPX playback, joystick movement, geofences, and location-based games.",
      featureList: [
        "Teleport to GPS coordinates",
        "Plan and replay multi-point routes",
        "Import GPX tracks",
        "Steer simulated movement with a joystick",
        "Move through location-based apps and games",
      ],
      audience: [
        {
          "@type": "Audience",
          audienceType: "iPhone users of location-based apps and games",
        },
      ],
    },
  ],
};
