/**
 * Renders the core markdown tree (src/core/notes/markdown.ts) with Preact elements: every string
 * is a text node, never innerHTML. Links open in a new tab without opener or referrer. Keys are
 * positions: the tree is rebuilt from the text on every render and never reordered.
 */
import type { JSX } from "preact";
import { type Block, type Inline, parseMarkdown } from "@/core/notes/markdown";

function node(n: Inline, key: number): JSX.Element | string {
  if (n.type === "text") return n.text;
  if (n.type === "code") return <code key={key}>{n.text}</code>;
  if (n.type === "bold") return <strong key={key}>{inline(n.children)}</strong>;
  if (n.type === "italic") return <em key={key}>{inline(n.children)}</em>;
  return (
    <a key={key} href={n.href} target="_blank" rel="noopener noreferrer">
      {inline(n.children)}
    </a>
  );
}

const inline = (nodes: Inline[]) => nodes.map(node);

function block(b: Block, key: number): JSX.Element {
  if (b.type === "heading")
    return b.level === 1 ? (
      <h1 key={key}>{inline(b.children)}</h1>
    ) : (
      <h2 key={key}>{inline(b.children)}</h2>
    );
  if (b.type === "paragraph") return <p key={key}>{inline(b.children)}</p>;
  const items = b.items.map((it, j) => <li key={String(j)}>{inline(it)}</li>);
  return b.ordered ? (
    <ol key={key} start={b.start}>
      {items}
    </ol>
  ) : (
    <ul key={key}>{items}</ul>
  );
}

export function MarkdownView({ text, class: cls }: { text: string; class?: string }) {
  return <div class={cls}>{parseMarkdown(text).map(block)}</div>;
}
