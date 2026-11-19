import React from 'react';
import { Check } from 'lucide-react';

export interface StepItem {
  id: number;
  label: string;
}

interface StepperProps {
  steps: StepItem[];
  currentStep: number;
  maxReachableStep: number;
  onSelectStep: (stepId: number) => void;
}

export const Stepper: React.FC<StepperProps> = ({
  steps,
  currentStep,
  maxReachableStep,
  onSelectStep,
}) => {
  return (
    <nav aria-label="Cleaning workflow progress" className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {steps.map((step) => {
          const isCurrent = step.id === currentStep;
          const isCompleted = step.id < currentStep;
          const isClickable = step.id <= maxReachableStep;

          return (
            <li key={step.id}>
              <button
                type="button"
                disabled={!isClickable}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => isClickable && onSelectStep(step.id)}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isCurrent
                    ? 'border-blue-700 bg-blue-50 text-blue-900'
                    : isCompleted
                    ? 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50 cursor-pointer'
                    : isClickable
                    ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer'
                    : 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-semibold tabular-nums ${
                    isCurrent
                      ? 'bg-blue-700 text-white'
                      : isCompleted
                      ? 'bg-emerald-700 text-white'
                      : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {isCompleted ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : step.id}
                </span>
                <span className="truncate">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
