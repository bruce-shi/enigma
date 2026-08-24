import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";
import { MarkdownArticle } from "../components/MarkdownArticle";
import { requireDocumentationPage } from "../docs";
import { createErrorMeta, createPageMeta } from "../seo";

export function loader({ params }: LoaderFunctionArgs) {
  return { slug: requireDocumentationPage(params.slug).slug };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (!loaderData) {
    return createErrorMeta(true);
  }
  const page = requireDocumentationPage(loaderData.slug);
  return createPageMeta({
    title: `${page.title} | Enigma Location Changer Docs`,
    description: page.description,
    path: page.path,
  });
};

export default function DocumentationPage() {
  const { slug } = useLoaderData<typeof loader>();
  const page = requireDocumentationPage(slug);
  return <MarkdownArticle markdown={page.markdown} />;
}
