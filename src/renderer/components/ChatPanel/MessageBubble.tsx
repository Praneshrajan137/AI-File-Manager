import React, { useMemo } from 'react';
import { User, Bot, FileCode2 } from 'lucide-react';
import { Message } from '@renderer/hooks/useLLM';
import { parseCitationSegments } from '@renderer/utils/explorerHelpers';
import { extractBasename } from '@renderer/utils/pathHelpers';

interface MessageBubbleProps {
  message: Message;
  onOpenCitation?: (filePath: string, startLine?: number, endLine?: number) => void;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onOpenCitation }) => {
  const isUser = message.role === 'user';

  const segments = useMemo(() => {
    if (isUser) return null;
    return parseCitationSegments(message.content);
  }, [isUser, message.content]);

  const resolveFilePathForName = (nameOrPath: string): string => {
    const clean = nameOrPath.trim();
    const matchFromStructured = message.structuredSources?.find(
      (s) =>
        s.filePath === clean ||
        extractBasename(s.filePath).toLowerCase() === clean.toLowerCase()
    );
    if (matchFromStructured) return matchFromStructured.filePath;

    const matchFromPaths = message.sources?.find(
      (p) => p === clean || extractBasename(p).toLowerCase() === clean.toLowerCase()
    );
    return matchFromPaths ?? clean;
  };

  return (
    <div
      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
      data-testid={isUser ? 'user-message' : 'assistant-message'}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5 text-white" />
        </div>
      )}

      <div className={`max-w-[82%] ${isUser ? 'order-first' : ''}`}>
        <div
          className={`rounded-lg p-3 ${
            isUser
              ? 'bg-primary-500 text-white'
              : 'bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-100'
          }`}
        >
          <p className="text-sm whitespace-pre-wrap">
            {isUser || !segments
              ? message.content
              : segments.map((seg, idx) => {
                  if (seg.type === 'citation' && seg.fileName) {
                    const targetPath = resolveFilePathForName(seg.fileName);
                    return (
                      <button
                        key={idx}
                        type="button"
                        data-testid="inline-citation-link"
                        onClick={() => onOpenCitation?.(targetPath, seg.startLine, seg.endLine)}
                        className="inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono text-xs hover:underline cursor-pointer"
                        title={`Inspect ${targetPath}${seg.startLine ? ` at line ${seg.startLine}` : ''}`}
                      >
                        {seg.content}
                      </button>
                    );
                  }
                  return <React.Fragment key={idx}>{seg.content}</React.Fragment>;
                })}
          </p>
        </div>

        {message.structuredSources && message.structuredSources.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5" data-testid="message-structured-sources">
            {message.structuredSources.map((source, idx) => {
              const name = extractBasename(source.filePath);
              const lineSuffix = source.startLine
                ? `#L${source.startLine}${source.endLine && source.endLine > source.startLine ? `-L${source.endLine}` : ''}`
                : '';
              return (
                <button
                  key={`${source.filePath}-${source.startLine ?? idx}-${idx}`}
                  type="button"
                  data-testid="source-citation-pill"
                  onClick={() => onOpenCitation?.(source.filePath, source.startLine, source.endLine)}
                  title={source.heading ? `${source.filePath} (${source.heading})` : source.filePath}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 text-[11px] font-mono text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900 transition-colors"
                >
                  <FileCode2 className="w-3 h-3" />
                  <span>
                    {name}
                    {lineSuffix}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          message.sources &&
          message.sources.length > 0 && (
            <div className="mt-2 text-xs text-gray-500 dark:text-slate-400">
              <span className="font-semibold">Sources:</span>{' '}
              {message.sources.map((source, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onOpenCitation?.(source)}
                  className="underline cursor-pointer hover:text-primary-600 dark:hover:text-indigo-400"
                >
                  {extractBasename(source)}
                  {idx < message.sources!.length - 1 && ', '}
                </button>
              ))}
            </div>
          )
        )}
      </div>

      {isUser && (
        <div className="w-8 h-8 rounded-full bg-gray-300 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
          <User className="w-5 h-5 text-gray-600 dark:text-slate-200" />
        </div>
      )}
    </div>
  );
};
