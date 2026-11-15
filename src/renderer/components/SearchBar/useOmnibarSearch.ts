import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContentSearchMatch, GraphInsightsResponse } from '@shared/contracts';
import { extractBasename } from '@renderer/utils/pathHelpers';
import type {
  GraphBacklinkMatch,
  GraphSymbolMatch,
  OmnibarCommandItem,
  OmnibarRow,
} from './OmnibarResultRow';

export type OmnibarTab = 'all' | 'files' | 'content' | 'commands';

interface UseOmnibarSearchParams {
  isOpen: boolean;
  query: string;
  activeTab: OmnibarTab;
  commands: OmnibarCommandItem[];
  onResetSelection: () => void;
}

interface UseOmnibarSearchResult {
  rows: OmnibarRow[];
  graphInsights: GraphInsightsResponse | null;
  loadingResults: boolean;
}

/**
 * Manages debounced omnibar search queries across files, FTS5 snippets, graph symbols,
 * backlinks, duplicate clusters, and workspace commands with stale-request gating.
 */
export function useOmnibarSearch({
  isOpen,
  query,
  activeTab,
  commands,
  onResetSelection,
}: UseOmnibarSearchParams): UseOmnibarSearchResult {
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [contentResults, setContentResults] = useState<ContentSearchMatch[]>([]);
  const [symbolResults, setSymbolResults] = useState<GraphSymbolMatch[]>([]);
  const [backlinkResults, setBacklinkResults] = useState<GraphBacklinkMatch[]>([]);
  const [graphInsights, setGraphInsights] = useState<GraphInsightsResponse | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const searchSeqRef = useRef(0);
  const resetSelectionRef = useRef(onResetSelection);
  resetSelectionRef.current = onResetSelection;

  useEffect(() => {
    if (!isOpen) return;
    setFileResults([]);
    setContentResults([]);
    setSymbolResults([]);
    setBacklinkResults([]);

    window.electronAPI?.graph
      ?.queryInsights?.()
      .then((insights) => setGraphInsights(insights))
      .catch(() => setGraphInsights(null));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const trimmed = query.trim();
    const seq = ++searchSeqRef.current;

    if (/^@sym:/i.test(trimmed)) {
      const symQuery = trimmed.slice(5).trim();
      setFileResults([]);
      setContentResults([]);
      setBacklinkResults([]);
      if (symQuery.length < 1) {
        setSymbolResults([]);
        setLoadingResults(false);
        return;
      }
      setLoadingResults(true);
      const timer = setTimeout(async () => {
        try {
          const insights = await window.electronAPI?.graph?.queryInsights?.({
            symbolQuery: symQuery,
          });
          if (seq !== searchSeqRef.current) return;
          setSymbolResults(insights?.symbolMatches ?? []);
          resetSelectionRef.current();
        } finally {
          if (seq === searchSeqRef.current) setLoadingResults(false);
        }
      }, 120);
      return (): void => clearTimeout(timer);
    }

    if (/^link:/i.test(trimmed)) {
      const target = trimmed.slice(5).trim();
      setFileResults([]);
      setContentResults([]);
      setSymbolResults([]);
      if (target.length < 1) {
        setBacklinkResults([]);
        setLoadingResults(false);
        return;
      }
      setLoadingResults(true);
      const timer = setTimeout(async () => {
        try {
          const insights = await window.electronAPI?.graph?.queryInsights?.({
            backlinkTarget: target,
          });
          if (seq !== searchSeqRef.current) return;
          setBacklinkResults(insights?.backlinks ?? []);
          resetSelectionRef.current();
        } finally {
          if (seq === searchSeqRef.current) setLoadingResults(false);
        }
      }, 120);
      return (): void => clearTimeout(timer);
    }

    if (/^dup:/i.test(trimmed)) {
      setFileResults([]);
      setContentResults([]);
      setSymbolResults([]);
      setBacklinkResults([]);
      setLoadingResults(false);
      return;
    }

    setSymbolResults([]);
    setBacklinkResults([]);

    if (trimmed.length < 2 || activeTab === 'commands') {
      setFileResults([]);
      setContentResults([]);
      setLoadingResults(false);
      return;
    }

    setLoadingResults(true);
    const debounceTimer = setTimeout(async () => {
      try {
        const shouldSearchFiles = activeTab === 'all' || activeTab === 'files';
        const shouldSearchContent = activeTab === 'all' || activeTab === 'content';

        const [filesRes, contentRes] = await Promise.allSettled([
          shouldSearchFiles
            ? window.electronAPI.search.autocomplete(trimmed, 8)
            : Promise.resolve<string[]>([]),
          shouldSearchContent && window.electronAPI.search.content
            ? window.electronAPI.search.content(trimmed, 8)
            : Promise.resolve<ContentSearchMatch[]>([]),
        ]);

        if (seq !== searchSeqRef.current) return;
        setFileResults(filesRes.status === 'fulfilled' ? filesRes.value : []);
        setContentResults(contentRes.status === 'fulfilled' ? contentRes.value : []);
        resetSelectionRef.current();
      } finally {
        if (seq === searchSeqRef.current) {
          setLoadingResults(false);
        }
      }
    }, 150);

    return (): void => clearTimeout(debounceTimer);
  }, [isOpen, query, activeTab]);

  const filteredCommands = useMemo(() => {
    const rawTrimmed = query.trim();
    if (/^(?:@sym:|link:|dup:)/i.test(rawTrimmed)) return [];
    if (activeTab !== 'all' && activeTab !== 'commands') return [];
    const q = rawTrimmed.toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (cmd) =>
        cmd.label.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q)
    );
  }, [commands, query, activeTab]);

  const rows = useMemo<OmnibarRow[]>(() => {
    const out: OmnibarRow[] = [];
    const trimmed = query.trim();

    if (/^@sym:/i.test(trimmed)) {
      for (const match of symbolResults) {
        out.push({
          kind: 'symbol',
          key: `sym:${match.filePath}:${match.symbolName}:${match.lineNumber}`,
          match,
        });
      }
      return out;
    }

    if (/^link:/i.test(trimmed)) {
      for (const match of backlinkResults) {
        out.push({
          kind: 'backlink',
          key: `link:${match.sourcePath}:${match.lineNumber}`,
          match,
        });
      }
      return out;
    }

    if (/^dup:/i.test(trimmed)) {
      const needle = trimmed.slice(4).trim().toLowerCase();
      for (const cluster of graphInsights?.stats.duplicateClusters ?? []) {
        if (
          !needle ||
          cluster.sha256.toLowerCase().includes(needle) ||
          cluster.files.some((f) => f.toLowerCase().includes(needle))
        ) {
          out.push({
            kind: 'duplicate',
            key: `dup:${cluster.sha256}`,
            cluster,
          });
        }
      }
      return out;
    }

    if (activeTab === 'all' || activeTab === 'content') {
      for (const match of contentResults) {
        out.push({ kind: 'content', key: `content:${match.chunkId}`, match });
      }
    }
    if (activeTab === 'all' || activeTab === 'files') {
      for (const filePath of fileResults) {
        out.push({
          kind: 'file',
          key: `file:${filePath}`,
          path: filePath,
          name: extractBasename(filePath),
        });
      }
    }
    if (activeTab === 'all' || activeTab === 'commands') {
      for (const cmd of filteredCommands) {
        out.push({ kind: 'command', key: `cmd:${cmd.id}`, command: cmd });
      }
    }
    return out;
  }, [
    activeTab,
    backlinkResults,
    contentResults,
    fileResults,
    filteredCommands,
    graphInsights,
    query,
    symbolResults,
  ]);

  return { rows, graphInsights, loadingResults };
}
