/**
 * osTrashAdapter.ts - Isolates optional Electron shell.trashItem access behind a single adapter
 * so journal/vault services stay independent of Electron globals.
 */

export async function defaultOsTrash(targetPath: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const electronModule = require('electron') as {
    shell?: { trashItem?: (p: string) => Promise<void> };
  };
  const trashItem = electronModule?.shell?.trashItem;
  if (typeof trashItem !== 'function') {
    throw new Error('OS Recycle Bin / Trash API unavailable in current runtime');
  }
  await trashItem(targetPath);
}
