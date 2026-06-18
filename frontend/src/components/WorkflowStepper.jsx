import React from 'react';
import { CheckCircle2, Circle, Loader2, ChevronRight } from 'lucide-react';

/**
 * Modern horizontal workflow stepper — click to scroll to step.
 */
export default function WorkflowStepper({ steps, currentStep, onStepClick, className = '' }) {
  if (!steps?.length) return null;

  return (
    <nav className={`rounded-2xl border border-gray-200/80 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3 shadow-sm min-w-0 ${className}`} aria-label="Workflow steps">
      <ol className="flex flex-col sm:flex-row gap-2 sm:gap-0 sm:items-stretch sm:overflow-x-auto sm:max-w-full header-scroll-x">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const isCurrent = currentStep === step.id;
          const isDone = step.done;
          const isActive = step.active || isCurrent;

          return (
            <li key={step.id} className="flex flex-1 items-center min-w-0 sm:min-w-[9rem] sm:max-w-[14rem] shrink-0">
              <button
                type="button"
                onClick={() => onStepClick?.(step.id)}
                className={`group flex flex-1 items-center gap-2.5 p-2.5 sm:p-3 rounded-xl text-left transition-all w-full min-w-0
                  ${isCurrent ? 'bg-brand-50 dark:bg-neutral-800 ring-2 ring-brand-400/60 shadow-sm' : ''}
                  ${isDone && !isCurrent ? 'opacity-90' : ''}
                  ${!isDone && !isCurrent ? 'hover:bg-gray-50 dark:hover:bg-neutral-800/60' : ''}
                `}
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm shadow-sm
                  ${isDone ? 'bg-emerald-500 text-white' : isActive ? 'bg-brand-600 text-white' : 'bg-gray-100 dark:bg-neutral-800 text-gray-500'}
                `}>
                  {isDone ? <CheckCircle2 className="w-5 h-5" /> : isActive && step.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : Icon ? <Icon className="w-4 h-4" /> : i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-semibold truncate ${isCurrent ? 'text-brand-700 dark:text-brand-300' : 'text-gray-900 dark:text-gray-100'}`}>
                    {step.title}
                  </p>
                  <p className="text-[10px] text-muted truncate">{step.subtitle}</p>
                </div>
                {isCurrent && <ChevronRight className="w-4 h-4 text-brand-500 shrink-0 hidden sm:block" />}
              </button>
              {i < steps.length - 1 && (
                <div className={`hidden sm:block w-4 h-0.5 shrink-0 mx-0.5 rounded ${isDone ? 'bg-emerald-400' : 'bg-gray-200 dark:bg-neutral-700'}`} aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
