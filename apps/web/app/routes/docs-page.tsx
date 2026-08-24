import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { MarkdownArticle } from "../components/MarkdownArticle";
import { requireDocumentationPage } from "../docs";

export function loader({ params }: LoaderFunctionArgs) {
  return { slug: requireDocumentationPage(params.slug).slug };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return [{ title: "Documentation not found — Enigma" }];
  }
  const page = requireDocumentationPage(loaderData.slug);
  return [
    { title: `${page.title} — Enigma documentation` },
    { name: "description", content: page.description },
    { tagName: "link", rel: "canonical", href: `https://enigma.bruceshi.com${page.path}` },
  ];
};

export default function DocumentationPage() {
  const { slug } = useLoaderData<typeof loader>();
  const page = requireDocumentationPage(slug);
  return <MarkdownArticle markdown={page.markdown} />;
}
