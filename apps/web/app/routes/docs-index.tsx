import type { MetaFunction } from "react-router";
import { MarkdownArticle } from "../components/MarkdownArticle";
import { requireDocumentationPage } from "../docs";
import { createPageMeta } from "../seo";

const page = requireDocumentationPage();

export const meta: MetaFunction = () =>
  createPageMeta({
    title: `${page.title} | Enigma Location Changer Docs`,
    description: page.description,
    path: page.path,
  });

export default function DocumentationIndex() {
  return <MarkdownArticle markdown={page.markdown} />;
}
