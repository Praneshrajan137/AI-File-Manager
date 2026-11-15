import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatInput } from '@renderer/components/ChatPanel/ChatInput';
import { MessageBubble } from '@renderer/components/ChatPanel/MessageBubble';
import { DryRunPlanModal } from '@renderer/components/Organizer/DryRunPlanModal';
import { CommandOmnibar } from '@renderer/components/SearchBar/CommandOmnibar';
import { getErrorMessage } from '@renderer/utils/formatters';
import type { Message } from '@renderer/hooks/useLLM';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('Stage 6 (M12): Packaging Contracts, Icons, & Copilot/Organizer UI Components', () => {
  describe('Desktop App Icons & Packaging Metadata Contracts', () => {
    it('ships valid high-resolution PNG, ICO, and ICNS icons in build/', () => {
      const pngPath = path.join(REPO_ROOT, 'build', 'icon.png');
      const icoPath = path.join(REPO_ROOT, 'build', 'icon.ico');
      const icnsPath = path.join(REPO_ROOT, 'build', 'icon.icns');

      expect(fs.existsSync(pngPath)).toBe(true);
      expect(fs.existsSync(icoPath)).toBe(true);
      expect(fs.existsSync(icnsPath)).toBe(true);

      const png = fs.readFileSync(pngPath);
      expect(png.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
      expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      expect(width).toBeGreaterThanOrEqual(256);
      expect(height).toBeGreaterThanOrEqual(256);

      const ico = fs.readFileSync(icoPath);
      expect(ico.readUInt16LE(0)).toBe(0); // reserved
      expect(ico.readUInt16LE(2)).toBe(1); // ICO type
      expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(4); // multi-resolution entries

      const icns = fs.readFileSync(icnsPath);
      expect(icns.subarray(0, 4).toString('ascii')).toBe('icns');
      expect(icns.readUInt32BE(4)).toBe(icns.length);
      expect(icns.includes(Buffer.from('ic08'))).toBe(true);
    });

    it('keeps package.json license, author, and zero-warning lint aligned with LICENSE & electron-builder.yml', () => {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8')
      ) as {
        author?: string;
        license?: string;
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const licenseText = fs.readFileSync(path.join(REPO_ROOT, 'LICENSE'), 'utf-8');
      const builderYaml = fs.readFileSync(
        path.join(REPO_ROOT, 'electron-builder.yml'),
        'utf-8'
      );

      expect(pkg.author).toBe('Praneshrajan');
      expect(pkg.license).toBe('CC-BY-NC-4.0');
      expect(licenseText).toContain('Creative Commons Attribution-NonCommercial 4.0');
      expect(pkg.scripts?.lint).toContain('--max-warnings=0');
      expect(pkg.dependencies?.electron).toBeUndefined();
      expect(pkg.devDependencies?.electron).toBeDefined();

      expect(builderYaml).toContain('asar: true');
      expect(builderYaml).toContain('node_modules/**/*.node');
      expect(builderYaml).toContain('node_modules/@lancedb/**');
      expect(builderYaml).toContain('node_modules/onnxruntime-node/**');
      expect(builderYaml).toContain('node_modules/@huggingface/transformers/**');
      expect(builderYaml).toContain('node_modules/sharp/**');
      expect(builderYaml).toContain('build/icon.ico');
      expect(builderYaml).toContain('build/icon.icns');
      expect(builderYaml).toContain('build/icon.png');
      expect(
        fs.existsSync(path.join(REPO_ROOT, 'scripts', 'verify-unpacked-build.mjs'))
      ).toBe(true);
    });
  });

  describe('Shared UI Error Formatting & Stage 5 Renderer Component Markup', () => {
    it('formats Error instances with non-empty messages and falls back on empty/non-Error values', () => {
      expect(getErrorMessage(new Error('Disk full'), 'Fallback')).toBe('Disk full');
      expect(getErrorMessage(new Error(''), 'Fallback')).toBe('Fallback');
      expect(getErrorMessage('Permission denied', 'Fallback')).toBe('Fallback');
      expect(getErrorMessage({ message: 'Conflict detected' }, 'Fallback')).toBe('Fallback');
      expect(getErrorMessage(null, 'Unknown failure')).toBe('Unknown failure');
    });

    it('renders ChatInput scope chips (@folder, @selection) and Agent (ReAct) mode toggle', () => {
      const html = renderToStaticMarkup(
        React.createElement(ChatInput, {
          value: 'Explain circuit breaker',
          onChange: () => {},
          onSend: () => {},
          currentPath: '/vault/src',
          selectedCount: 2,
          useFolder: true,
          useSelection: true,
          mode: 'agent',
          onToggleFolder: () => {},
          onToggleSelection: () => {},
          onToggleMode: () => {},
        })
      );

      expect(html).toContain('data-testid="chip-folder"');
      expect(html).toContain('@folder');
      expect(html).toContain('data-testid="chip-selection"');
      expect(html).toContain('@selection (2)');
      expect(html).toContain('data-testid="chip-agent-mode"');
      expect(html).toContain('Agent (ReAct)');
      expect(html).toContain('data-testid="chat-input"');
      expect(html).toContain('data-testid="send-button"');
    });

    it('renders MessageBubble inline citations, structured source pills, and ReAct trace badge', () => {
      const assistantMessage: Message = {
        id: 7,
        role: 'assistant',
        content: 'Found details in [notes.md#L5-L8] regarding retry backoff.',
        sources: ['/vault/notes.md'],
        structuredSources: [
          {
            filePath: '/vault/notes.md',
            startLine: 5,
            endLine: 8,
            heading: 'Resilience',
          },
        ],
        agentSteps: [
          {
            step: 1,
            thought: 'Read notes lines',
            tool: 'read_file_range',
            arguments: { filePath: '/vault/notes.md', startLine: 5, endLine: 8 },
            allowed: true,
            observationSummary: 'Read lines 5-8',
            durationMs: 12,
          },
        ],
        timestamp: 1700000000000,
      };

      const html = renderToStaticMarkup(
        React.createElement(MessageBubble, {
          message: assistantMessage,
          onOpenCitation: () => {},
        })
      );

      expect(html).toContain('data-testid="assistant-message"');
      expect(html).toContain('data-testid="inline-citation-link"');
      expect(html).toContain('notes.md#L5-L8');
      expect(html).toContain('data-testid="agent-trace-badge"');
      expect(html).toContain('ReAct Trace (1 step)');
      expect(html).toContain('data-testid="source-citation-pill"');
      expect(html).toContain('L5-L8');
    });

    it('renders DryRunPlanModal and CommandOmnibar cleanly when closed vs open', () => {
      const closedModal = renderToStaticMarkup(
        React.createElement(DryRunPlanModal, {
          isOpen: false,
          targetDir: '/vault',
          onClose: () => {},
          onApplied: () => {},
        })
      );
      expect(closedModal).toBe('');

      const openModal = renderToStaticMarkup(
        React.createElement(DryRunPlanModal, {
          isOpen: true,
          targetDir: '/vault',
          onClose: () => {},
          onApplied: () => {},
        })
      );
      expect(openModal).toContain('data-testid="dry-run-plan-modal"');
      expect(openModal).toContain('data-testid="plan-strategy-select"');
      expect(openModal).toContain('data-testid="plan-apply-button"');

      const openOmnibar = renderToStaticMarkup(
        React.createElement(CommandOmnibar, {
          isOpen: true,
          onClose: () => {},
          currentPath: '/vault',
          onNavigateFile: () => {},
          onOpenCitation: () => {},
          isDarkMode: false,
          onToggleTheme: () => {},
          splitPaneOpen: false,
          onToggleSplitPane: () => {},
          onToggleChat: () => {},
          onIndexCurrentDir: () => {},
          onOrganizeCurrentDir: () => {},
        })
      );
      expect(openOmnibar).toContain('data-testid="command-omnibar"');
      expect(openOmnibar).toContain('data-testid="omnibar-input"');
      expect(openOmnibar).toContain('Organize Current Folder');
    });
  });
});
