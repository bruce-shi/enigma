import "@enigma/ui/styles.css";
import type { LinksFunction, MetaFunction } from "react-router";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";

export const meta: MetaFunction = () => [
  { title: "Enigma — iPhone location testing from your desktop" },
  {
    name: "description",
    content: "A privacy-first desktop utility for controlled iPhone location simulation.",
  },
];

export const links: LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

const themeScript = `(()=>{const m=document.cookie.match(/(?:^|; )enigma_theme=([^;]+)/);const p=m?decodeURIComponent(m[1]):'system';const d=p==='dark'||(p==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'enigma-dark':'enigma-light';document.documentElement.classList.toggle('dark',d)})()`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="enigma-light" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <meta content="light dark" name="color-scheme" />
        <Meta />
        <Links />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Unexpected error";
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="enigma-surface max-w-lg p-8 text-center">
        <h1 className="text-2xl font-semibold">Enigma hit a problem</h1>
        <p className="mt-3 text-muted-foreground">{message}</p>
        <a className="mt-6 inline-block text-accent underline" href="/">
          Return home
        </a>
      </div>
    </main>
  );
}
