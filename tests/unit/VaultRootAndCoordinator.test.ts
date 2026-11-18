import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultRootAuthority, resolveEffectiveAllowedRoots } from '@main/platform/VaultRootAuthority';
import { FsCommandCoordinator } from '@main/kernel/FsCommandCoordinator';
import { ConfigManager } from '@shared/config';

describe('VaultRootAuthority & FsCommandCoordinator invariants', () => {
  afterEach(() => {
    VaultRootAuthority.getInstance().invalidate();
    jest.restoreAllMocks();
  });

  it('normalizes legacy Documents/Downloads/Desktop defaults to homedir consistently', () => {
    const home = os.homedir();
    const legacy = [
      path.join(home, 'Documents'),
      path.join(home, 'Downloads'),
      path.join(home, 'Desktop'),
    ];
    expect(resolveEffectiveAllowedRoots(legacy)).toEqual([home]);

    const custom = [path.join(home, 'Documents'), path.join(home, 'Projects')];
    expect(resolveEffectiveAllowedRoots(custom)).toEqual(custom.map((p) => path.resolve(p)));
  });

  it('notifies subscribers automatically on applyAllowedRoots and reacts to ConfigManager drift', () => {
    const authority = VaultRootAuthority.getInstance();
    const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-root-a-'));
    const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-root-b-'));

    try {
      const notifications: string[][] = [];
      const unsub = authority.onRootsChanged((roots) => notifications.push(roots));

      authority.applyAllowedRoots([tmpA]);
      expect(authority.getValidator().getAllowedRoots()).toEqual([path.resolve(tmpA)]);
      expect(notifications).toEqual([[path.resolve(tmpA)]]);

      // Simulate external ConfigManager mutation without manually calling sync helpers
      ConfigManager.initialize();
      jest.spyOn(ConfigManager.getInstance(), 'get').mockReturnValue({
        allowedRoots: [tmpB],
      } as never);

      expect(authority.resolveAllowedRoots()).toEqual([path.resolve(tmpB)]);
      expect(notifications).toHaveLength(2);
      expect(notifications[1]).toEqual([path.resolve(tmpB)]);
      unsub();
    } finally {
      fs.rmSync(tmpA, { recursive: true, force: true });
      fs.rmSync(tmpB, { recursive: true, force: true });
    }
  });

  it('brackets writeFile with suppressPaths before disk mutation and notifyMutation after', async () => {
    const events: string[] = [];
    const coordinator = new FsCommandCoordinator({
      getKernel: () =>
        ({
          suppressPaths: (paths: string[]): void => {
            events.push(`suppress:${paths.join(',')}`);
          },
          getFileSystemService: () => ({
            writeFile: async (filePath: string): Promise<{ success: boolean }> => {
              events.push(`write:${filePath}`);
              return { success: true };
            },
          }),
          notifyMutation: (type: string, filePath: string): void => {
            events.push(`notify:${type}:${filePath}`);
          },
        }) as never,
      getJournal: () => ({}) as never,
    });

    await coordinator.writeFile('/vault/note.md', 'hello');
    expect(events).toEqual([
      'suppress:/vault/note.md',
      'write:/vault/note.md',
      'notify:change:/vault/note.md',
    ]);
  });
});
