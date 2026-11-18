/**
 * @copyright 2025 Praneshrajan
 * @license CC-BY-NC-4.0
 * @author Praneshrajan (https://github.com/Praneshrajan137)
 */

import { TrieNode, FileMetadata } from '@shared/contracts';
import path from 'path';

interface BasenameTrieNode {
    children: Map<string, BasenameTrieNode>;
    paths: Map<string, string>;
}

export interface FuzzySearchMatch {
    path: string;
    score: number;
}

function computeCharMask(text: string): number {
    let mask = 0;
    for (let i = 0; i < text.length; i += 1) {
        mask |= 1 << (text.charCodeAt(i) & 31);
    }
    return mask;
}

function popcount32(n: number): number {
    let x = n | 0;
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/**
 * PathTrie - Prefix tree for O(L) file path search & basename lookup.
 * 
 * Dual-indexed:
 * 1. Segment trie rooted at `root` for full hierarchical path lookups (/home/user/doc -> ...)
 * 2. Character-level basename trie rooted at `basenameRoot` for O(L) filename prefix lookups ('rep' -> report.md)
 * 3. O(1) maintained entry count & bounded Damerau-Levenshtein fuzzy matcher.
 */
export class PathTrie {
    private root: TrieNode;
    private basenameRoot: BasenameTrieNode;
    private indexedEntries = new Map<
        string,
        { basename: string; stem: string; path: string; stemMask: number; baseMask: number }
    >();
    private totalCount = 0;
    private dpRowPrev2 = new Int32Array(256);
    private dpRowPrev1 = new Int32Array(256);
    private dpRowCurr = new Int32Array(256);

    constructor() {
        this.root = {
            children: new Map(),
            isEndOfPath: false,
        };
        this.basenameRoot = {
            children: new Map(),
            paths: new Map(),
        };
    }

    /**
     * Insert a file path into the trie with associated metadata.
     * 
     * @param filePath - Absolute path to file
     * @param metadata - File metadata to store at terminal node
     * 
     * @complexity O(L) where L = number of path segments + basename length
     * 
     * @throws Error if path is empty or metadata is inconsistent
     */
    insert(filePath: string, metadata: FileMetadata): void {
        // Validate input
        if (!filePath || filePath.trim().length === 0) {
            throw new Error('Path cannot be empty');
        }

        // Normalize path to handle double slashes and case
        const normalized = this.normalizePath(filePath);

        // Validate metadata consistency
        const normalizedMetadataPath = this.normalizePath(metadata.filePath);
        if (normalized !== normalizedMetadataPath) {
            throw new Error('Metadata filePath must match the inserted path');
        }

        const segments = this.splitPath(normalized);

        let currentNode = this.root;

        for (const segment of segments) {
            // Convert to lowercase for case-insensitive matching
            const key = segment.toLowerCase();

            if (!currentNode.children.has(key)) {
                currentNode.children.set(key, {
                    children: new Map(),
                    isEndOfPath: false,
                });
            }

            currentNode = currentNode.children.get(key)!;
        }

        // Mark as terminal node and store metadata (increment O(1) count only on new insertions)
        const wasEndOfPath = currentNode.isEndOfPath;
        currentNode.isEndOfPath = true;
        currentNode.metadata = metadata;
        if (!wasEndOfPath) {
            this.totalCount++;
        }

        // Also index basename for O(L) filename prefix autocomplete & fuzzy lookup
        const canonicalKey = normalized.toLowerCase();
        const basename = segments[segments.length - 1]?.toLowerCase() ?? '';
        if (basename.length > 0) {
            this.insertBasename(basename, canonicalKey, metadata.filePath);
            const dotIdx = basename.lastIndexOf('.');
            const stem = dotIdx > 0 ? basename.slice(0, dotIdx) : basename;
            const baseMask = computeCharMask(basename);
            const stemMask = stem === basename ? baseMask : computeCharMask(stem);
            this.indexedEntries.set(canonicalKey, {
                basename,
                stem,
                path: metadata.filePath,
                stemMask,
                baseMask,
            });
        }
    }

    /**
     * Search for exact path match.
     * 
     * @param filePath - Path to search for
     * @returns FileMetadata if found, null otherwise
     * 
     * @complexity O(L) where L = number of path segments
     * 
     * @throws Error if path is empty
     * 
     * @example
     * const metadata = trie.search('/home/user/file.txt');
     * if (metadata) {
     *   console.log('File found:', metadata.filePath);
     * }
     */
    search(filePath: string): FileMetadata | null {
        // Validate input
        if (!filePath || filePath.trim().length === 0) {
            throw new Error('Path cannot be empty');
        }

        const normalized = this.normalizePath(filePath);
        const segments = this.splitPath(normalized);

        let currentNode = this.root;

        for (const segment of segments) {
            const key = segment.toLowerCase();

            if (!currentNode.children.has(key)) {
                return null; // Path doesn't exist
            }

            currentNode = currentNode.children.get(key)!;
        }

        // Only return metadata if this is a complete path
        return currentNode.isEndOfPath ? currentNode.metadata ?? null : null;
    }

    /**
     * Get autocomplete suggestions for partial path.
     * 
     * @param prefix - Partial path (e.g., '/home/user/do')
     * @param maxResults - Maximum number of results (default: 10)
     * @returns Array of complete paths matching prefix
     * 
     * @complexity O(L + M) where L = prefix length, M = number of matches
     * 
     * @throws Error if prefix is empty
     * 
     * @example
     * const suggestions = trie.autocomplete('/home/user/doc', 5);
     * // Returns: ['/home/user/documents/file1.txt', '/home/user/documents/file2.txt', ...]
     */
    autocomplete(prefix: string, maxResults: number = 10): string[] {
        // Validate input
        if (!prefix || prefix.trim().length === 0) {
            throw new Error('Prefix cannot be empty');
        }

        if (maxResults <= 0) {
            return [];
        }

        const trimmed = prefix.trim();
        const hasPathSeparator = trimmed.includes('/') || trimmed.includes('\\');

        if (!hasPathSeparator) {
            const results: string[] = [];
            const seen = new Set<string>();
            this.autocompleteBasename(trimmed.toLowerCase(), results, seen, maxResults);

            if (results.length < maxResults) {
                const keyPrefix = trimmed.toLowerCase();
                for (const [childKey, childNode] of this.root.children.entries()) {
                    if (childKey.startsWith(keyPrefix)) {
                        const rootMatches: string[] = [];
                        this.collectPaths(childNode, rootMatches, maxResults - results.length);
                        for (const match of rootMatches) {
                            const canonical = match.replace(/\\/g, '/').toLowerCase();
                            if (!seen.has(canonical)) {
                                seen.add(canonical);
                                results.push(match);
                                if (results.length >= maxResults) {
                                    break;
                                }
                            }
                        }
                    }
                    if (results.length >= maxResults) {
                        break;
                    }
                }
            }

            return results;
        }

        const normalized = this.normalizePath(prefix);
        const segments = this.splitPath(normalized);
        const results: string[] = [];

        if (segments.length === 0) {
            this.collectPaths(this.root, results, maxResults);
            return results;
        }

        let currentNode = this.root;

        // Navigate parent segments strictly
        for (let i = 0; i < segments.length - 1; i++) {
            const key = segments[i].toLowerCase();
            if (!currentNode.children.has(key)) {
                return [];
            }
            currentNode = currentNode.children.get(key)!;
        }

        // Last segment supports both exact match and partial segment prefix match
        const lastKey = segments[segments.length - 1].toLowerCase();
        const exactChild = currentNode.children.get(lastKey);
        if (exactChild) {
            this.collectPaths(exactChild, results, maxResults);
        }

        if (results.length < maxResults) {
            for (const [childKey, childNode] of currentNode.children.entries()) {
                if (childKey !== lastKey && childKey.startsWith(lastKey)) {
                    this.collectPaths(childNode, results, maxResults);
                    if (results.length >= maxResults) {
                        break;
                    }
                }
            }
        }

        return results;
    }

    /**
     * Remove a file path from the trie.
     * 
     * @param filePath - Path to remove
     * @returns true if path was found and removed, false otherwise
     * 
     * @complexity O(L) where L = number of path segments
     * 
     * @example
     * const removed = trie.remove('/home/user/file.txt');
     * if (removed) {
     *   console.log('File removed from index');
     * }
     */
    remove(filePath: string): boolean {
        // Validate input
        if (!filePath || filePath.trim().length === 0) {
            return false;
        }

        const normalized = this.normalizePath(filePath);
        const segments = this.splitPath(normalized);

        // Navigate to the target node and track the path
        const nodePath: TrieNode[] = [this.root];
        let currentNode = this.root;

        for (const segment of segments) {
            const key = segment.toLowerCase();

            if (!currentNode.children.has(key)) {
                return false; // Path doesn't exist
            }

            currentNode = currentNode.children.get(key)!;
            nodePath.push(currentNode);
        }

        // Check if this is actually a terminal node
        if (!currentNode.isEndOfPath) {
            return false; // Not a complete path
        }

        // Mark as not end of path and remove metadata
        currentNode.isEndOfPath = false;
        currentNode.metadata = undefined;
        this.totalCount = Math.max(0, this.totalCount - 1);

        // Clean up empty nodes from bottom to top
        // We don't remove nodes that have children or are terminal nodes for other paths
        for (let i = segments.length - 1; i >= 0; i--) {
            const node = nodePath[i + 1];
            const parentNode = nodePath[i];
            const segment = segments[i];
            const key = segment.toLowerCase();

            // Only remove if node has no children and is not a terminal node
            if (node.children.size === 0 && !node.isEndOfPath) {
                parentNode.children.delete(key);
            } else {
                // Stop cleanup if node is still in use
                break;
            }
        }

        const canonicalKey = normalized.toLowerCase();
        this.indexedEntries.delete(canonicalKey);
        const basename = segments[segments.length - 1]?.toLowerCase() ?? '';
        if (basename.length > 0) {
            this.removeBasename(basename, canonicalKey);
        }

        return true;
    }

    /**
     * Remove a file or an entire directory subtree (all descendant paths matching prefix).
     */
    removePrefix(prefixPath: string): number {
        if (!prefixPath || prefixPath.trim().length === 0) {
            return 0;
        }

        const normalized = this.normalizePath(prefixPath);
        const segments = this.splitPath(normalized);
        let currentNode = this.root;

        for (const segment of segments) {
            const key = segment.toLowerCase();
            const next = currentNode.children.get(key);
            if (!next) {
                return 0;
            }
            currentNode = next;
        }

        const targets: string[] = [];
        this.collectPaths(currentNode, targets, Number.MAX_SAFE_INTEGER);

        let removedCount = 0;
        for (const target of targets) {
            if (this.remove(target)) {
                removedCount++;
            }
        }
        return removedCount;
    }

    /**
     * Find indexed paths whose basename contains the given case-insensitive substring.
     */
    searchSubstring(substring: string, maxResults: number = 50): string[] {
        const needle = substring.trim().toLowerCase();
        if (!needle || maxResults <= 0) {
            return [];
        }

        const matches: string[] = [];
        for (const entry of this.indexedEntries.values()) {
            if (entry.basename.includes(needle)) {
                matches.push(entry.path);
                if (matches.length >= maxResults) {
                    break;
                }
            }
        }
        return matches;
    }

    private insertBasename(basename: string, canonicalKey: string, storedPath: string): void {
        let current = this.basenameRoot;
        for (const ch of basename) {
            let next = current.children.get(ch);
            if (!next) {
                next = { children: new Map(), paths: new Map() };
                current.children.set(ch, next);
            }
            current = next;
        }
        current.paths.set(canonicalKey, storedPath);
    }

    private removeBasename(basename: string, canonicalKey: string): void {
        const nodePath: BasenameTrieNode[] = [this.basenameRoot];
        let current = this.basenameRoot;
        for (const ch of basename) {
            const next = current.children.get(ch);
            if (!next) {
                return;
            }
            current = next;
            nodePath.push(current);
        }

        current.paths.delete(canonicalKey);

        for (let i = basename.length - 1; i >= 0; i--) {
            const node = nodePath[i + 1];
            const parent = nodePath[i];
            if (node.children.size === 0 && node.paths.size === 0) {
                parent.children.delete(basename[i]);
            } else {
                break;
            }
        }
    }

    private autocompleteBasename(
        prefix: string,
        results: string[],
        seen: Set<string>,
        maxResults: number
    ): void {
        let current = this.basenameRoot;
        for (const ch of prefix) {
            const next = current.children.get(ch);
            if (!next) {
                return;
            }
            current = next;
        }

        const collectBasename = (node: BasenameTrieNode): void => {
            if (results.length >= maxResults) {
                return;
            }
            for (const [canonical, storedPath] of node.paths.entries()) {
                if (!seen.has(canonical)) {
                    seen.add(canonical);
                    results.push(storedPath);
                    if (results.length >= maxResults) {
                        return;
                    }
                }
            }
            for (const child of node.children.values()) {
                collectBasename(child);
                if (results.length >= maxResults) {
                    return;
                }
            }
        };

        collectBasename(current);
    }

    /**
     * Recursively collect all complete paths from a node.
     * 
     * @param node - Current trie node
     * @param results - Array to accumulate results
     * @param maxResults - Maximum results to collect
     */
    private collectPaths(
        node: TrieNode,
        results: string[],
        maxResults: number
    ): void {
        // Stop if we've collected enough results
        if (results.length >= maxResults) {
            return;
        }

        // If this is a terminal node, add the complete path
        if (node.isEndOfPath && node.metadata) {
            results.push(node.metadata.filePath);
        }

        // Recursively explore children
        for (const [, childNode] of node.children.entries()) {
            this.collectPaths(childNode, results, maxResults);

            // Early exit if we have enough results
            if (results.length >= maxResults) {
                break;
            }
        }
    }

    /**
     * Normalize path for consistent handling.
     * 
     * Converts Windows paths to Unix style and handles special cases.
     * 
     * @param filePath - Raw path
     * @returns Normalized path
     */
    private normalizePath(filePath: string): string {
        // Use Node's path.normalize to handle .., ., and // correctly
        let normalized = path.normalize(filePath);

        // Convert Windows paths to Unix style for consistency
        // This ensures all paths are stored uniformly in the trie
        normalized = normalized.replace(/\\/g, '/');

        // Remove trailing slash (except for root)
        if (normalized !== '/' && normalized.endsWith('/')) {
            normalized = normalized.slice(0, -1);
        }

        return normalized;
    }

    /**
     * Split path into segments, filtering out empty strings.
     * 
     * @param filePath - Normalized path
     * @returns Array of path segments
     * 
     * @example
     * splitPath('/home/user/file.txt') => ['home', 'user', 'file.txt']
     */
    private splitPath(filePath: string): string[] {
        // Filter out empty segments as defensive programming
        // path.normalize() should prevent these, but we filter just in case
        return filePath
            .split('/')
            .filter(segment => segment.length > 0);
    }

    /**
     * Fuzzy basename/stem matcher using exact/prefix/substring fast-paths + bounded
     * optimal string alignment (Damerau-Levenshtein) edit distance.
     */
    fuzzySearch(
        query: string,
        maxResults: number = 15,
        maxDistance: number = 2
    ): FuzzySearchMatch[] {
        const needle = query.trim().toLowerCase();
        if (!needle || maxResults <= 0) {
            return [];
        }

        const useBasenameTarget = needle.includes('.');
        const needleMask = computeCharMask(needle);
        const scored: FuzzySearchMatch[] = [];
        for (const entry of this.indexedEntries.values()) {
            const target = entry.basename;
            const stem = entry.stem;

            if (target === needle || stem === needle) {
                scored.push({ path: entry.path, score: 1.0 });
                continue;
            }
            if (target.startsWith(needle) || stem.startsWith(needle)) {
                scored.push({ path: entry.path, score: 0.92 - Math.min(0.1, (target.length - needle.length) * 0.005) });
                continue;
            }
            if (target.includes(needle)) {
                scored.push({ path: entry.path, score: 0.8 - Math.min(0.15, target.indexOf(needle) * 0.01) });
                continue;
            }

            const compareTarget = useBasenameTarget ? target : stem;
            if (Math.abs(compareTarget.length - needle.length) <= maxDistance) {
                const targetMask = useBasenameTarget ? entry.baseMask : entry.stemMask;
                const lowerBound = Math.max(
                    popcount32(needleMask & ~targetMask),
                    popcount32(targetMask & ~needleMask)
                );
                if (lowerBound <= maxDistance) {
                    const dist = this.boundedDamerauLevenshtein(needle, compareTarget, maxDistance);
                    if (dist <= maxDistance) {
                        const norm = 1 - dist / Math.max(needle.length, compareTarget.length, 1);
                        scored.push({ path: entry.path, score: Number((0.65 * norm).toFixed(4)) });
                    }
                }
                continue;
            }

            if (compareTarget.length > needle.length && needle.length >= 4) {
                const targetMask = useBasenameTarget ? entry.baseMask : entry.stemMask;
                if (popcount32(needleMask & ~targetMask) <= maxDistance) {
                    const sameLenPrefix = compareTarget.slice(0, needle.length);
                    const plusOnePrefix = compareTarget.slice(0, needle.length + 1);
                    const dist = Math.min(
                        this.boundedDamerauLevenshtein(needle, sameLenPrefix, maxDistance),
                        this.boundedDamerauLevenshtein(needle, plusOnePrefix, maxDistance)
                    );
                    if (dist <= maxDistance) {
                        const norm = 1 - dist / Math.max(needle.length, 1);
                        scored.push({ path: entry.path, score: Number((0.6 * norm).toFixed(4)) });
                    }
                }
            }
        }

        scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
        return scored.slice(0, maxResults);
    }

    private ensureDpCapacity(needed: number): void {
        if (needed <= this.dpRowCurr.length) {
            return;
        }
        const nextSize = Math.max(needed, this.dpRowCurr.length * 2);
        this.dpRowPrev2 = new Int32Array(nextSize);
        this.dpRowPrev1 = new Int32Array(nextSize);
        this.dpRowCurr = new Int32Array(nextSize);
    }

    private boundedDamerauLevenshtein(a: string, b: string, maxDist: number): number {
        const m = a.length;
        const n = b.length;
        if (Math.abs(m - n) > maxDist) return maxDist + 1;
        if (m === 0) return n;
        if (n === 0) return m;

        this.ensureDpCapacity(n + 1);
        let prev2 = this.dpRowPrev2;
        let prev1 = this.dpRowPrev1;
        let curr = this.dpRowCurr;

        for (let j = 0; j <= n; j += 1) {
            prev1[j] = j;
        }

        for (let i = 1; i <= m; i += 1) {
            curr[0] = i;
            let rowMin = i;
            const chA = a.charCodeAt(i - 1);
            const prevChA = i > 1 ? a.charCodeAt(i - 2) : -1;

            for (let j = 1; j <= n; j += 1) {
                const chB = b.charCodeAt(j - 1);
                const cost = chA === chB ? 0 : 1;
                let val = prev1[j] + 1;
                const ins = curr[j - 1] + 1;
                if (ins < val) val = ins;
                const sub = prev1[j - 1] + cost;
                if (sub < val) val = sub;

                if (i > 1 && j > 1 && chA === b.charCodeAt(j - 2) && prevChA === chB) {
                    const trans = prev2[j - 2] + 1;
                    if (trans < val) val = trans;
                }
                curr[j] = val;
                if (val < rowMin) rowMin = val;
            }
            if (rowMin > maxDist) {
                return maxDist + 1;
            }

            const tmp = prev2;
            prev2 = prev1;
            prev1 = curr;
            curr = tmp;
        }

        return prev1[n];
    }

    /**
     * Remove any indexed entry that is no longer inside `allowedRoots`.
     */
    pruneOutsideRoots(allowedRoots: readonly string[]): number {
        const cmp = (p: string): string =>
            process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p);
        const rootPrefixes = allowedRoots.map((r) => {
            const k = cmp(r).replace(/[\\/]+$/, '');
            return { key: k, prefix: `${k}${path.sep}` };
        });

        let removed = 0;
        for (const entry of Array.from(this.indexedEntries.values())) {
            const entryKey = cmp(entry.path);
            const isInside = rootPrefixes.some(
                ({ key, prefix }) => entryKey === key || entryKey.startsWith(prefix)
            );
            if (!isInside && this.remove(entry.path)) {
                removed += 1;
            }
        }
        return removed;
    }

    /**
     * Get the total number of paths stored in the trie in O(1) time.
     *
     * @returns Number of complete paths
     */
    public size(): number {
        return this.totalCount;
    }

    /**
     * Clear all paths from the trie.
     */
    public clear(): void {
        const clearNode = (node: TrieNode): void => {
            // Recursively clear children first
            for (const child of node.children.values()) {
                clearNode(child);
            }

            // Explicitly clear the map and null metadata
            node.children.clear();
            node.metadata = undefined;
            node.isEndOfPath = false;
        };

        clearNode(this.root);
        this.indexedEntries.clear();
        this.totalCount = 0;

        // Reinitialize roots
        this.root = {
            children: new Map(),
            isEndOfPath: false,
        };

        const clearBasenameNode = (node: BasenameTrieNode): void => {
            for (const child of node.children.values()) {
                clearBasenameNode(child);
            }
            node.children.clear();
            node.paths.clear();
        };

        clearBasenameNode(this.basenameRoot);
        this.basenameRoot = {
            children: new Map(),
            paths: new Map(),
        };
    }
}
