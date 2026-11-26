import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CodeBlockProps {
  language: string;
  code: string;
  label?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, code, label }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700/70 bg-slate-950/95 text-slate-100 shadow-lg backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-slate-800/80 bg-slate-900/90 px-4 py-2.5 text-xs">
        <span className="font-mono text-cyan-300/90">{label ?? language}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${label ?? language} code`}
          className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/90 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 whitespace-nowrap shrink-0 cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-slate-100">
        <code>{code}</code>
      </pre>
    </div>
  );
};
