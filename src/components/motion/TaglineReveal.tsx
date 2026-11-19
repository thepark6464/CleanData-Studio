import React, { useEffect, useMemo, useRef, useState } from 'react';

interface TaglineRevealProps {
  lines: string[];
}

export const TaglineReveal: React.FC<TaglineRevealProps> = ({ lines }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  const tokenizedLines = useMemo(() => {
    let globalIndex = 0;
    return lines.map((line) =>
      line.split(/\s+/).filter(Boolean).map((word) => ({
        word,
        index: globalIndex++,
      })),
    );
  }, [lines]);

  const totalWords = useMemo(
    () => tokenizedLines.reduce((sum, line) => sum + line.length, 0),
    [tokenizedLines],
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setProgress(1);
      return;
    }

    let rafId: number | null = null;

    const measure = () => {
      rafId = null;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 800;
      const startLine = vh * 0.84;
      const endLine = vh * 0.34;
      const raw = (startLine - rect.top) / Math.max(1, startLine - endLine);
      const clamped = Math.max(0, Math.min(1, raw));
      setProgress((prev) => (Math.abs(prev - clamped) > 0.005 ? clamped : prev));
    };

    const scheduleMeasure = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure, { passive: true });

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [reducedMotion]);

  const activeWordCount = reducedMotion
    ? totalWords
    : Math.floor(progress * (totalWords + 0.25));

  return (
    <div ref={containerRef} className="mx-auto max-w-[680px]">
      <h2 className="heading-2 text-slate-950">
        {tokenizedLines.map((line, lineIdx) => (
          <span key={lineIdx} className="block">
            {line.map((token, wordIdx) => {
              const isLit = token.index < activeWordCount;
              return (
                <React.Fragment key={token.index}>
                  <span
                    className={`inline-block transition-opacity duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      isLit ? 'opacity-100' : 'opacity-[0.28]'
                    }`}
                  >
                    {token.word}
                  </span>
                  {wordIdx < line.length - 1 ? ' ' : ''}
                </React.Fragment>
              );
            })}
          </span>
        ))}
      </h2>
    </div>
  );
};
