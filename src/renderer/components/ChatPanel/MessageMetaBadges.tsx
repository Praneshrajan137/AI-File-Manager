import React from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { Message } from '@renderer/hooks/useLLM';

interface MessageMetaBadgesProps {
  message: Message;
}

/** Verification, grounding, and termination reason badges rendered below assistant responses. */
export const MessageMetaBadges: React.FC<MessageMetaBadgesProps> = ({ message }) => {
  const showVerification =
    message.verification &&
    (message.verification.totalCitations > 0 ||
      !message.verification.grounded ||
      message.verification.redactionsApplied > 0);
  const showTermination =
    message.terminationReason &&
    ['wall_clock_budget', 'cycle_broken', 'step_limit'].includes(message.terminationReason);

  if (!showVerification && !showTermination) return null;

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {showVerification && message.verification && (
        <span
          data-testid="grounding-verification-badge"
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-medium ${
            message.verification.grounded
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
          }`}
        >
          {message.verification.grounded ? (
            <ShieldCheck className="w-2.5 h-2.5" />
          ) : (
            <ShieldAlert className="w-2.5 h-2.5" />
          )}
          <span>
            {message.verification.grounded
              ? `${message.verification.verifiedCitations} citation${message.verification.verifiedCitations === 1 ? '' : 's'} verified`
              : `${message.verification.ungroundedCitations.length} unverified citation${message.verification.ungroundedCitations.length === 1 ? '' : 's'} blocked`}
            {message.verification.redactionsApplied > 0
              ? ` · ${message.verification.redactionsApplied} redacted`
              : ''}
          </span>
        </span>
      )}
      {message.terminationReason === 'wall_clock_budget' && (
        <span
          data-testid="termination-reason-badge"
          className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-[10px] font-medium text-amber-800 dark:text-amber-300"
        >
          Time budget reached
        </span>
      )}
      {message.terminationReason === 'cycle_broken' && (
        <span
          data-testid="termination-reason-badge"
          className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-[10px] font-medium text-amber-800 dark:text-amber-300"
        >
          Loop guard triggered
        </span>
      )}
      {message.terminationReason === 'step_limit' && (
        <span
          data-testid="termination-reason-badge"
          className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-medium text-slate-600 dark:text-slate-300"
        >
          Max tool steps reached
        </span>
      )}
    </div>
  );
};
