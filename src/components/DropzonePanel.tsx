import React, { useRef, useState } from 'react';
import { AlertCircle, FileSpreadsheet, ShieldCheck, Upload } from 'lucide-react';

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
        className={`relative rounded-xl border-2 border-dashed bg-white p-8 sm:p-10 text-center transition-colors ${
          isDragging
            ? 'border-blue-600 bg-blue-50/40'
            : 'border-slate-300 hover:border-slate-400'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={handleInputChange}
          aria-label="Choose a CSV or XLSX file to inspect and clean"
          className="sr-only"
        />

        <div className="mx-auto flex max-w-xl flex-col items-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-blue-700">
            <FileSpreadsheet className="h-6 w-6" aria-hidden="true" />
          </div>

          <h2
            id="upload-heading"
            className="font-display text-xl font-semibold text-slate-900"
          >
            Drop a CSV or XLSX file to inspect and clean
          </h2>

          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Auto-detects UTF-8, UTF-8 BOM, or Windows-1252 encoding, CSV delimiters, and static XLSX worksheets (zero formula evaluation). Browser limit: 5 MB.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              disabled={isLoading}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-800 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              <span>{isLoading ? 'Inspecting file...' : 'Browse CSV or XLSX'}</span>
            </button>

            <button
              type="button"
              disabled={isLoading}
              onClick={onLoadSampleFixture}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <span>Load Messy Sample Fixture</span>
            </button>
          </div>

          <div className="mt-5 flex items-center justify-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0" aria-hidden="true" />
            <span>
              Browser-only processing · File contents never leave your device or hit a server
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold">{error.title}</p>
            {error.details && <p className="text-red-800">{error.details}</p>}
          </div>
        </div>
      )}
    </section>
  );
};
