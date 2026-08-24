import "@enigma/ui/styles.css";
import type { LinksFunction, MetaFunction } from "react-router";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, useRouteError } from "react-router";
import { createErrorMeta, createPageMeta, defaultSeo } from "./seo";

export const meta: MetaFunction = ({ error }) => {
  if (error) {
    return createErrorMeta(isRouteErrorResponse(error) && error.status === 404);
  }

  return createPageMeta({
    ...defaultSeo,
    path: "/",
  });
};

export const links: LinksFunction = () => [
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="enigma-light">
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <meta content="light dark" name="color-scheme" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
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
