"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders AI answers (AutoSage returns Markdown: bold, headings, lists, tables).
 * Raw HTML is not rendered (react-markdown's default), so model output can't inject markup.
 */
const components: Components = {
  h1: ({ children }) => <h3 className="mt-4 mb-1.5 font-display text-lg font-bold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-1.5 font-display text-base font-bold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1 font-bold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-3 mb-1 font-bold first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-bold text-pine">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-pine-soft">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-pine-soft">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-teal underline underline-offset-2">
      {children}
    </a>
  ),
  blockquote: ({ children }) => <blockquote className="my-2 border-l-4 border-honey/60 pl-3 text-pine-soft">{children}</blockquote>,
  hr: () => <hr className="my-3 border-pine/10" />,
  code: ({ children }) => <code className="rounded bg-pine/8 px-1 py-0.5 font-mono text-[0.85em]">{children}</code>,
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-xl bg-pine/8 p-3 text-sm">{children}</pre>,
  // Tables scroll sideways inside narrow panels instead of overflowing.
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xl ring-1 ring-pine/10">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-pine/6 text-pine">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 font-bold whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="border-t border-pine/8 px-3 py-2 align-top">{children}</td>,
};

export function Markdown({ children, className = "" }: { children: string; className?: string }) {
  return (
    <div className={`text-[15px] leading-relaxed text-pine/90 ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
