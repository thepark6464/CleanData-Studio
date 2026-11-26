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
    <nav
      aria-label="Cleaning workflow progress"
      className="glass-surface rounded-2xl p-2.5 sm:p-3"
    >
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
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
                className={`flex min-h-[44px] w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-xs font-medium transition-all duration-200 whitespace-nowrap shrink-0 ${
                  isCurrent
                    ? 'border-blue-400/70 bg-gradient-to-r from-blue-600/12 via-blue-500/10 to-violet-500/10 text-blue-950 shadow-sm'
                    : isCompleted
                    ? 'border-emerald-200/80 bg-white/80 text-slate-900 hover:bg-white cursor-pointer'
                    : isClickable
                    ? 'border-slate-200/80 bg-white/75 text-slate-700 hover:bg-white cursor-pointer'
                    : 'border-slate-200/50 bg-white/40 text-slate-400 cursor-not-allowed'
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600`}
              >
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg font-mono text-[11px] font-semibold tabular-nums ${
                    isCurrent
                      ? 'bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-sm'
                      : isCompleted
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-200/80 text-slate-600'
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
