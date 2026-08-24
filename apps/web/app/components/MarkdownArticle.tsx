import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { rewriteDocumentationLink } from "../docs";

const components: Components = {
  h1: (props) => <h1 className="text-4xl font-semibold tracking-tight md:text-5xl" {...props} />,
  h2: (props) => <h2 className="mt-12 text-2xl font-semibold tracking-tight" {...props} />,
  h3: (props) => <h3 className="mt-8 text-lg font-semibold" {...props} />,
  p: (props) => <p className="mt-4 leading-7 text-muted-foreground" {...props} />,
  ul: (props) => <ul className="mt-4 list-disc space-y-2 pl-6 text-muted-foreground" {...props} />,
  ol: (props) => (
    <ol className="mt-4 list-decimal space-y-2 pl-6 text-muted-foreground" {...props} />
  ),
  li: (props) => <li className="pl-1 leading-7" {...props} />,
  a: ({ href = "", ...props }) => {
    const destination = rewriteDocumentationLink(href);
    const external = /^https?:\/\//u.test(destination);
    return (
      <a
        className="font-medium text-accent underline decoration-accent/35 underline-offset-4 hover:decoration-accent"
        href={destination}
        rel={external ? "noreferrer" : undefined}
        target={external ? "_blank" : undefined}
        {...props}
      />
    );
  },
  blockquote: (props) => (
    <blockquote className="mt-6 border-l-2 border-accent pl-4 text-muted-foreground" {...props} />
  ),
  pre: (props) => (
    <pre
      className="mt-5 overflow-x-auto rounded-xl border border-border bg-surface-secondary p-4 text-sm leading-6"
      {...props}
    />
  ),
  code: ({ className, ...props }) => (
    <code
      className={`${className ?? ""} rounded bg-surface-secondary px-1.5 py-0.5 font-mono text-[.9em] text-foreground`}
      {...props}
    />
  ),
  table: (props) => (
    <div className="mt-6 overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[680px] border-collapse text-left text-sm" {...props} />
    </div>
  ),
  th: (props) => (
    <th className="border-b border-border bg-surface-secondary p-3 font-semibold" {...props} />
  ),
  td: (props) => (
    <td className="border-b border-border p-3 align-top text-muted-foreground" {...props} />
  ),
  hr: (props) => <hr className="my-10 border-border" {...props} />,
};

export function MarkdownArticle({ markdown }: { markdown: string }) {
  return (
    <article className="min-w-0 pb-16">
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]} skipHtml>
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
