import compatibility from "../../../docs/compatibility.md?raw";
import desktopSetup from "../../../docs/desktop-setup.md?raw";
import embeddedSetup from "../../../docs/embedded-setup.md?raw";
import gettingStarted from "../../../docs/getting-started.md?raw";
import privacy from "../../../docs/privacy-and-reliability.md?raw";
import troubleshooting from "../../../docs/troubleshooting.md?raw";

const repository = "https://github.com/bruce-shi/enigma";

export type DocumentationPage = {
  slug: string;
  path: string;
  source: string;
  title: string;
  description: string;
  markdown: string;
};

export const documentationPages: DocumentationPage[] = [
  {
    slug: "",
    path: "/docs",
    source: "docs/getting-started.md",
    title: "Getting started",
    description: "Pair an iPhone, run a first Set and Restore check, and choose a movement mode.",
    markdown: gettingStarted,
  },
  {
    slug: "desktop-setup",
    path: "/docs/desktop-setup",
    source: "docs/desktop-setup.md",
    title: "Desktop setup",
    description: "Configure local iPhone control, optional search, storage, and recovery.",
    markdown: desktopSetup,
  },
  {
    slug: "embedded-setup",
    path: "/docs/embedded-setup",
    source: "docs/embedded-setup.md",
    title: "Embedded setup",
    description: "Verify, flash, provision, and operate the supported Lichuang ESP32-S3 board.",
    markdown: embeddedSetup,
  },
  {
    slug: "compatibility",
    path: "/docs/compatibility",
    source: "docs/compatibility.md",
    title: "Compatibility",
    description: "Review Enigma's qualified host, iOS, transport, and embedded-board paths.",
    markdown: compatibility,
  },
  {
    slug: "troubleshooting",
    path: "/docs/troubleshooting",
    source: "docs/troubleshooting.md",
    title: "Troubleshooting",
    description: "Resolve device discovery, provisioning, map, recovery, and updater problems.",
    markdown: troubleshooting,
  },
  {
    slug: "privacy",
    path: "/docs/privacy",
    source: "docs/privacy-and-reliability.md",
    title: "Privacy",
    description: "Understand which Enigma data stays local and when third-party services are used.",
    markdown: privacy,
  },
];

const pageBySlug = new Map(documentationPages.map((page) => [page.slug, page]));
const routeBySource = new Map(
  documentationPages.flatMap((page) => {
    const filename = page.source.slice("docs/".length);
    return [
      [filename, page.path],
      [`docs/${filename}`, page.path],
    ];
  }),
);

export function getDocumentationPage(slug = "") {
  return pageBySlug.get(slug);
}

export function requireDocumentationPage(slug = "") {
  const page = getDocumentationPage(slug);
  if (!page) {
    throw new Response("Documentation page not found", { status: 404, statusText: "Not Found" });
  }
  return page;
}

export function rewriteDocumentationLink(href: string) {
  if (!href || href.startsWith("#") || /^(?:[a-z]+:)?\/\//iu.test(href)) {
    return href;
  }

  const fragmentIndex = href.indexOf("#");
  const fragment = fragmentIndex >= 0 ? href.slice(fragmentIndex) : "";
  const path = (fragmentIndex >= 0 ? href.slice(0, fragmentIndex) : href)
    .replace(/^\.\//u, "")
    .replace(/^\/+/u, "");
  const publicRoute = routeBySource.get(path);
  if (publicRoute) {
    return `${publicRoute}${fragment}`;
  }
  if (path.endsWith(".md")) {
    return `${repository}/blob/main/${path.startsWith("docs/") ? path : `docs/${path}`}${fragment}`;
  }
  return href;
}
