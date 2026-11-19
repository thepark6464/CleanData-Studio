import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Download, Server, ShieldCheck } from 'lucide-react';
import {
  buildDefaultOperations,
  type CleaningOperationConfig,
  type CleaningResult,
  type ColumnType,
  CsvParseError,
  type DatasetInspection,
  parseCsvBuffer,
  parseXlsxBuffer,
  runCleaningPipeline,
} from '../lib/cleaner';
import {
  CleanDataApiClient,
  CleanDataApiError,
  getApiBaseUrl,
} from '../lib/api/client';
import { estimateCreditsForRows } from '../config/pricing';
import { useAuth } from '../lib/auth/AuthContext';
import type { JobStatusResponse, ServerCleaningReport } from '../lib/api/types';
import messyCustomersFixture from '../../fixtures/messy_customers.csv?raw';
import { DropzonePanel } from '../components/DropzonePanel';
import { InspectionPanel } from '../components/InspectionPanel';
import { OperationsPanel } from '../components/OperationsPanel';
import { QualityScoreCard } from '../components/QualityScoreCard';
import { ReviewExportPanel } from '../components/ReviewExportPanel';
import { Stepper } from '../components/ui/Stepper';

interface CleanerPageProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

const CLEANER_STEPS = [
  { id: 1, label: 'Upload File' },
  { id: 2, label: 'Inspect & Detect' },
  { id: 3, label: 'Configure Rules' },
  { id: 4, label: 'Review & Export' },
];

export const CleanerPage: React.FC<CleanerPageProps> = ({ fileInputRef }) => {
  const { session, wallet, activePlan, preferences, refreshAccountData } = useAuth();
  const [processingMode, setProcessingMode] = useState<'browser' | 'server'>('browser');
  const [step, setStep] = useState<number>(1);
  const [rawFile, setRawFile] = useState<{
    fileObj?: File;
    buffer: ArrayBuffer;
    name: string;
    format: 'csv' | 'xlsx';
  } | null>(null);
  const [inspection, setInspection] = useState<DatasetInspection | null>(null);
  const [operations, setOperations] = useState<CleaningOperationConfig[]>([]);
  const [formulaProtection, setFormulaProtection] = useState<boolean>(
    preferences.formulaProtection,
  );
  const [cleaningResult, setCleaningResult] = useState<CleaningResult | null>(null);

  // Server processing state (Phase 3)
  const [serverOutputFormat, setServerOutputFormat] = useState<'csv' | 'xlsx'>('csv');
  const [serverJob, setServerJob] = useState<JobStatusResponse | null>(null);
  const [serverReport, setServerReport] = useState<ServerCleaningReport | null>(null);
  const [isServerSubmitting, setIsServerSubmitting] = useState<boolean>(false);

  const [error, setError] = useState<{ title: string; details?: string } | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const apiBaseUrl = getApiBaseUrl();

  useEffect(() => {
    if (!inspection) {
      setFormulaProtection(preferences.formulaProtection);
    }
  }, [preferences.formulaProtection, inspection]);

  const columnTypesMap = useMemo(() => {
    const map: Record<string, ColumnType> = {};
    if (inspection) {
      for (const col of inspection.columnProfiles) {
        map[col.name] = col.detectedType;
      }
    }
    return map;
  }, [inspection]);

  const applyInspection = (
    buffer: ArrayBuffer,
    filename: string,
    format: 'csv' | 'xlsx',
    inspected: DatasetInspection,
    fileObj?: File,
  ) => {
    const defaultOps = buildDefaultOperations(inspected, preferences);
    setRawFile({ fileObj, buffer, name: filename, format });
    setInspection(inspected);
    setOperations(defaultOps);
    setFormulaProtection(preferences.formulaProtection);
    setCleaningResult(null);
    setServerJob(null);
    setServerReport(null);
    setStep(2);
  };

  const processBuffer = async (
    buffer: ArrayBuffer,
    filename: string,
    options?: { delimiterOverride?: ',' | ';' | '\t' | '|'; selectedSheet?: string; fileObj?: File },
  ) => {
    setError(null);
    const isXlsx = filename.toLowerCase().endsWith('.xlsx');
    try {
      if (isXlsx) {
        const inspected = await parseXlsxBuffer(buffer, filename, options?.selectedSheet);
        applyInspection(buffer, filename, 'xlsx', inspected, options?.fileObj);
      } else {
        const inspected = parseCsvBuffer(buffer, filename, {
          delimiterOverride: options?.delimiterOverride,
        });
        applyInspection(buffer, filename, 'csv', inspected, options?.fileObj);
      }
    } catch (err) {
      if (err instanceof CsvParseError) {
        setError({ title: err.message, details: err.details });
      } else {
        setError({
          title: 'Unable to parse the selected file.',
          details: 'Verify the file is a valid UTF-8/Latin-1 CSV or .xlsx workbook.',
        });
      }
      setRawFile(null);
      setInspection(null);
      setOperations([]);
      setCleaningResult(null);
      setStep(1);
    }
  };

  const handleFileSelected = async (file: File) => {
    setIsLoading(true);
    setError(null);
    try {
      // In server mode, large files (> 5 MB) skip browser preview parsing and submit directly to FastAPI
      if (processingMode === 'server' && file.size > 5 * 1024 * 1024) {
        if (!apiBaseUrl) {
          setError({
            title: 'FastAPI backend URL is not configured.',
            details:
              'Files over 5 MB require the FastAPI backend. Start backend/app/main.py and set VITE_API_BASE_URL.',
          });
          return;
        }
        const client = new CleanDataApiClient(apiBaseUrl, session?.access_token);
        const uploaded = await client.uploadFile(file);
        const placeholderInspection: DatasetInspection = {
          filename: uploaded.filename,
          inputFormat: uploaded.input_format,
          byteSize: uploaded.byte_size,
          encoding: uploaded.encoding,
          delimiter: (uploaded.delimiter as ',' | ';' | '\t' | '|') || ',',
          rowCount: uploaded.row_count,
          columnCount: uploaded.column_count,
          headers: uploaded.headers,
          originalHeaders: uploaded.headers,
          rows: [],
          columnProfiles: uploaded.headers.map((h, idx) => ({
            name: h,
            originalName: h,
            index: idx,
            detectedType: 'text',
            nonEmptyCount: uploaded.row_count,
            missingCount: 0,
            uniqueCount: 0,
            invalidCount: 0,
            whitespaceIssueCount: 0,
            ambiguousDateCount: 0,
            formulaTriggerCount: 0,
            sampleValues: [],
          })),
          problems: {
            emptyRows: 0,
            duplicateRows: 0,
            whitespaceCells: 0,
            missingCells: 0,
            invalidEmails: 0,
            invalidPhones: 0,
            ambiguousDates: 0,
            unparseableDates: 0,
            formulaCells: 0,
            normalizedHeadersCount: 0,
            mixedTypeColumns: [],
          },
          qualityBefore: {
            score: 100,
            missingRate: 0,
            invalidRate: 0,
            duplicateRate: 0,
            typeInconsistencyRate: 0,
            missingCount: 0,
            invalidCount: 0,
            duplicateRowCount: 0,
            typeInconsistentCount: 0,
            totalCells: 0,
            totalRows: uploaded.row_count,
            formulaDescription:
              'Server-side quality score will be calculated during FastAPI processing.',
          },
          warnings: [
            {
              code: 'LARGE_FILE_SERVER_PATH',
              severity: 'info',
              message: `Large file (${(uploaded.byte_size / (1024 * 1024)).toFixed(2)} MB) uploaded to FastAPI server (${uploaded.file_id}). Configure operations and run on server.`,
            },
          ],
        };
        const defaultOps = buildDefaultOperations(placeholderInspection, preferences);
        setRawFile({ fileObj: file, buffer: new ArrayBuffer(0), name: file.name, format: uploaded.input_format });
        setInspection(placeholderInspection);
        setOperations(defaultOps);
        setStep(3);
        return;
      }

      const buffer = await file.arrayBuffer();
      await processBuffer(buffer, file.name, { fileObj: file });
    } catch (err) {
      if (err instanceof CleanDataApiError) {
        setError({ title: `${err.code}: ${err.message}` });
      } else {
        setError({ title: 'Failed to load file.' });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadSampleFixture = async () => {
    setIsLoading(true);
    try {
      const bytes = new TextEncoder().encode(messyCustomersFixture);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const sampleFile = new File([buffer], 'messy_customers.csv', { type: 'text/csv' });
      await processBuffer(buffer, 'messy_customers.csv', { fileObj: sampleFile });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelimiterOverride = async (delimiter: ',' | ';' | '\t' | '|') => {
    if (!rawFile || rawFile.format !== 'csv') return;
    await processBuffer(rawFile.buffer, rawFile.name, {
      delimiterOverride: delimiter,
      fileObj: rawFile.fileObj,
    });
  };

  const handleSheetChange = async (sheetName: string) => {
    if (!rawFile || rawFile.format !== 'xlsx') return;
    await processBuffer(rawFile.buffer, rawFile.name, {
      selectedSheet: sheetName,
      fileObj: rawFile.fileObj,
    });
  };

  const handleRunCleaning = async () => {
    if (!inspection) return;
    setError(null);

    if (processingMode === 'server') {
      if (!rawFile?.fileObj) {
        setError({ title: 'No file selected to submit to the FastAPI server.' });
        return;
      }
      setIsServerSubmitting(true);
      try {
        const client = new CleanDataApiClient(apiBaseUrl, session?.access_token);
        const created = await client.createCleanJob({
          file: rawFile.fileObj,
          operations,
          outputFormat: serverOutputFormat,
          formulaProtection,
          delimiterOverride: inspection.inputFormat === 'csv' ? inspection.delimiter : undefined,
          idempotencyKey: `studio_${Date.now().toString(36)}`,
        });
        const [statusRes, reportRes] = await Promise.all([
          client.getJobStatus(created.job_id),
          client.getJobReport(created.job_id),
        ]);
        setServerJob(statusRes);
        setServerReport(reportRes.report);
        setCleaningResult(null);
        setStep(4);
        if (session?.access_token) {
          void refreshAccountData();
        }
      } catch (err) {
        if (err instanceof CleanDataApiError) {
          setError({
            title: `Server API Error (${err.code})`,
            details: err.message,
          });
        } else {
          setError({
            title: 'Could not reach FastAPI backend.',
            details: 'Verify the FastAPI service is running and VITE_API_BASE_URL is configured.',
          });
        }
      } finally {
        setIsServerSubmitting(false);
      }
      return;
    }

    const result = runCleaningPipeline(inspection, operations, {
      formulaProtection,
    });
    setServerJob(null);
    setServerReport(null);
    setCleaningResult(result);
    setStep(4);
  };

  const handleFormulaProtectionChange = (enabled: boolean) => {
    setFormulaProtection(enabled);
    if (processingMode === 'browser' && inspection && cleaningResult) {
      const result = runCleaningPipeline(inspection, operations, {
        formulaProtection: enabled,
      });
      setCleaningResult(result);
    }
  };

  const maxReachableStep = !inspection
    ? 1
    : cleaningResult || serverJob
    ? 4
    : 3;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            CleanData Studio Workbench
          </h1>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
            {processingMode === 'browser' ? (
              <>
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-700 shrink-0" aria-hidden="true" />
                <span>
                  Browser Local Path (up to 5 MB) · Data stays on your device and is never sent to a server.
                </span>
              </>
            ) : (
              <>
                <Server className="h-3.5 w-3.5 text-blue-700 shrink-0" aria-hidden="true" />
                <span>
                  Server API Path (FastAPI + Pandas) · Files are transmitted to{' '}
                  <code className="font-mono">{apiBaseUrl || 'VITE_API_BASE_URL (not set)'}</code>.
                </span>
              </>
            )}
          </p>
        </div>

        {/* Processing Mode Segmented Toggle */}
        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="inline-flex rounded-lg bg-slate-200/70 p-1" role="group" aria-label="Processing path">
            <button
              type="button"
              onClick={() => setProcessingMode('browser')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                processingMode === 'browser'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Browser Local (≤5 MB)
            </button>
            <button
              type="button"
              onClick={() => setProcessingMode('server')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                processingMode === 'server'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Server API (FastAPI)
            </button>
          </div>
        </div>
      </div>

      {processingMode === 'server' && !apiBaseUrl && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-950">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <div>
            <strong>Server API endpoint not configured:</strong> Set{' '}
            <code className="font-mono">VITE_API_BASE_URL=http://localhost:8000</code> and run the FastAPI backend (<code className="font-mono">backend/app/main.py</code>) to execute server-side Pandas jobs. Switch back to <strong>Browser Local</strong> to process files directly in your browser.
          </div>
        </div>
      )}

      {error && step !== 1 && (
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

      <Stepper
        steps={CLEANER_STEPS}
        currentStep={step}
        maxReachableStep={maxReachableStep}
        onSelectStep={(target) => {
          if (target === 4 && !cleaningResult && !serverJob && inspection) {
            void handleRunCleaning();
          } else {
            setStep(target);
          }
        }}
      />

      {step === 1 && (
        <DropzonePanel
          fileInputRef={fileInputRef}
          onFileSelected={handleFileSelected}
          onLoadSampleFixture={handleLoadSampleFixture}
          error={error}
          isLoading={isLoading}
        />
      )}

      {step !== 1 && (
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFileSelected(file);
            e.target.value = '';
          }}
          aria-label="Upload replacement CSV or XLSX file"
          className="sr-only"
        />
      )}

      {step === 2 && inspection && (
        <div className="space-y-4">
          <InspectionPanel
            inspection={inspection}
            onDelimiterOverride={handleDelimiterOverride}
            onSheetChange={handleSheetChange}
          />
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Change File</span>
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 px-5 py-2 text-xs font-medium text-white hover:bg-blue-800 cursor-pointer"
            >
              <span>Configure Cleaning Rules</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {step === 3 && inspection && (
        <div className="space-y-4">
          {processingMode === 'server' && (
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-xs sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-0.5">
                <p className="font-medium text-slate-900">
                  Server Export Format &amp; Credit Estimate
                </p>
                <p className="font-mono text-slate-600 tabular-nums">
                  Estimated cost: <strong>{estimateCreditsForRows(inspection.rowCount)}</strong>{' '}
                  credit{estimateCreditsForRows(inspection.rowCount) === 1 ? '' : 's'} (
                  {inspection.rowCount.toLocaleString()} rows)
                  {wallet
                    ? ` · Available balance: ${
                        wallet.subscription_balance + wallet.purchased_balance
                      } (${activePlan?.name ?? 'Free'} plan)`
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="server-fmt"
                    checked={serverOutputFormat === 'csv'}
                    onChange={() => setServerOutputFormat('csv')}
                  />
                  <span className="font-mono">CSV</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="server-fmt"
                    checked={serverOutputFormat === 'xlsx'}
                    onChange={() => setServerOutputFormat('xlsx')}
                  />
                  <span className="font-mono">XLSX</span>
                </label>
              </div>
            </div>
          )}

          <OperationsPanel
            inspection={inspection}
            operations={operations}
            onChangeOperations={setOperations}
            formulaProtection={formulaProtection}
            onChangeFormulaProtection={handleFormulaProtectionChange}
            onRunCleaning={() => void handleRunCleaning()}
          />

          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Inspection</span>
            </button>
            {isServerSubmitting && (
              <span className="text-xs text-slate-600">Running FastAPI cleaning job...</span>
            )}
          </div>
        </div>
      )}

      {step === 4 && cleaningResult && (
        <div className="space-y-4">
          <ReviewExportPanel result={cleaningResult} columnTypes={columnTypesMap} />
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Adjust Operations</span>
            </button>
          </div>
        </div>
      )}

      {step === 4 && serverJob && serverReport && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-5">
            <div className="flex flex-col gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-display text-lg font-semibold text-slate-950">
                  Server Job Completed ({serverJob.job_id})
                </h2>
                <p className="mt-1 font-mono text-xs text-slate-600 tabular-nums">
                  Rows: {serverReport.rowsBefore} → {serverReport.rowsAfter} · Removed: {serverReport.recordsRemoved} · Formula-escaped: {serverReport.formulaCellsEscaped} · Credits charged: {serverJob.credits_charged ?? 0}
                </p>
              </div>
              {serverJob.download_url && (
                <a
                  href={serverJob.download_url}
                  download
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap shrink-0"
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  <span>Download Cleaned {serverJob.output_format.toUpperCase()} (Signed URL)</span>
                </a>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <QualityScoreCard
                title="Input Quality Score (Server)"
                breakdown={serverReport.qualityBefore}
              />
              <QualityScoreCard
                title="Cleaned Quality Score (Server)"
                breakdown={serverReport.qualityAfter}
                comparisonScore={serverReport.qualityBefore.score}
              />
            </div>

            {serverReport.warnings.length > 0 && (
              <ul className="space-y-1.5 text-xs">
                {serverReport.warnings.map((w, i) => (
                  <li
                    key={`${w.code}-${i}`}
                    className="flex items-start gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700"
                  >
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                    <span>{w.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={() => setStep(3)}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <span>Back to Operations</span>
          </button>
        </div>
      )}
    </div>
  );
};
