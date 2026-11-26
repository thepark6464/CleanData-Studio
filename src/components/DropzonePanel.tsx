import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';

interface DropzonePanelProps {
  onFileSelected: (file: File) => void;
  onLoadSampleFixture: () => void;
  error: { title: string; details?: string } | null;
  isLoading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export const DropzonePanel: React.FC<DropzonePanelProps> = ({
  onFileSelected,
  onLoadSampleFixture,
  error,
  isLoading,
  fileInputRef,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragDepthRef = useRef(0);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      onFileSelected(file);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelected(file);
    }
    e.target.value = '';
  };

  return (
    <section aria-labelledby="upload-heading" className="space-y-4">
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`glass-surface-elevated relative overflow-hidden rounded-3xl p-7 sm:p-12 text-center transition-all duration-300 ${
          isDragging
            ? 'ring-2 ring-blue-500 border-blue-400 scale-[1.005] bg-blue-50/40'
            : 'hover:border-blue-300/80'
        }`}
      >
        {/* Subtle inner dashed glass frame */}
        <div
          className={`pointer-events-none absolute inset-3 rounded-2xl border-2 border-dashed transition-colors duration-300 ${
            isDragging ? 'border-blue-500/80' : 'border-slate-300/70'
          }`}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={handleInputChange}
          aria-label="Choose a CSV or XLSX file to inspect and clean"
          className="sr-only"
        />

        <div className="relative z-10 mx-auto flex max-w-xl flex-col items-center">
          <div
            className={`mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/90 bg-gradient-to-br from-blue-600/12 via-cyan-500/10 to-violet-600/12 text-blue-700 shadow-sm transition-transform duration-300 ${
              isDragging ? 'scale-110' : ''
            }`}
          >
            {isLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-blue-700" aria-hidden="true" />
            ) : (
              <FileSpreadsheet className="h-6 w-6" aria-hidden="true" />
            )}
          </div>

          <h2
            id="upload-heading"
            className="font-display text-xl sm:text-2xl font-semibold tracking-tight text-slate-950"
          >
            {isDragging
              ? 'Release to inspect spreadsheet'
              : 'Drop a CSV or XLSX file to inspect and clean'}
          </h2>

          <p className="mt-2.5 text-sm text-slate-600 leading-relaxed">
            Auto-detects UTF-8, UTF-8 BOM, or Windows-1252 encoding, CSV delimiters, and static XLSX worksheets (zero formula evaluation). Browser limit: 5 MB.
          </p>

          <p className="mt-2 font-mono text-[11px] text-slate-500">
            CSV · TSV · TXT · XLSX · Up to 5 MB browser-local
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => fileInputRef.current?.click()}
              className="glass-btn-primary inline-flex min-h-[44px] items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span>{isLoading ? 'Inspecting file...' : 'Browse CSV or XLSX'}</span>
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={onLoadSampleFixture}
              className="glass-btn-secondary inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sparkles className="h-4 w-4 text-violet-600" aria-hidden="true" />
              <span>Load Messy Sample Fixture</span>
            </button>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-600">
            <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>
              Browser-only processing · File contents never leave your device or hit a server
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/90 p-4 text-sm text-rose-950 backdrop-blur-md"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold">{error.title}</p>
            {error.details && <p className="text-rose-800">{error.details}</p>}
          </div>
        </div>
      )}
    </section>
  );
};
