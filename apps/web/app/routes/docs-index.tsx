import type { MetaFunction } from "react-router";
import { MarkdownArticle } from "../components/MarkdownArticle";
import { requireDocumentationPage } from "../docs";

const page = requireDocumentationPage();

export const meta: MetaFunction = () => [
  { title: `${page.title} — Enigma documentation` },
  { name: "description", content: page.description },
  { tagName: "link", rel: "canonical", href: `https://enigma.bruceshi.com${page.path}` },
];

export default function DocumentationIndex() {
  return <MarkdownArticle markdown={page.markdown} />;
}
