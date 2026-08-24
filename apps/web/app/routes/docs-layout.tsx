import { Outlet, useLocation } from "react-router";
import { SiteShell } from "../components/SiteShell";
import { documentationPages } from "../docs";

export default function DocumentationLayout() {
  const location = useLocation();

  return (
    <SiteShell>
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:py-16">
        <aside className="min-w-0">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Documentation
          </p>
          <nav aria-label="Documentation" className="overflow-x-auto pb-2 lg:overflow-visible">
            <ul className="flex min-w-max gap-2 lg:min-w-0 lg:flex-col">
              {documentationPages.map((page) => {
                const active = location.pathname === page.path;
                return (
                  <li key={page.path}>
                    <a
                      aria-current={active ? "page" : undefined}
                      className={`block rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? "bg-accent/10 text-accent"
                          : "text-muted-foreground hover:bg-surface-secondary hover:text-foreground"
                      }`}
                      href={page.path}
                    >
                      {page.title}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>
        <main className="min-w-0">
          <Outlet />
        </main>
      </div>
    </SiteShell>
  );
}
