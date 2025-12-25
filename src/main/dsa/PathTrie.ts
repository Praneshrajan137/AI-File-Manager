/**
 * @copyright 2025 Praneshrajan
 * @license CC-BY-NC-4.0
 * @author Praneshrajan (https://github.com/Praneshrajan137)
 */

import { TrieNode, FileMetadata } from '@shared/contracts';
import path from 'path';

/**
 * PathTrie - Prefix tree for O(L) file path search.
 * 
 * Mimics how Linux kernel performs inode lookups. Instead of iterating
 * through all files (O(N)), we traverse the path segments (O(L) where
 * L = number of segments in path).
 * 
 * Example:
 *   insert('/home/user/file.txt')
 *   
 *   Creates tree:
 *   root -> 'home' -> 'user' -> 'file.txt' [terminal node with metadata]
 * 
 * Complexity Analysis:
 * - insert(): O(L) where L = path length
 * - search(): O(L) where L = path length
 * - autocomplete(): O(L + M) where M = number of matches
 * - remove(): O(L) where L = path length
 * 
 * Space Complexity: O(N * L) where N = number of paths, L = avg path length
 */
export class PathTrie {
    private root: TrieNode;

    constructor() {
        this.root = {
            children: new Map(),
            isEndOfPath: false,
        };
    }

    /**
     * Insert a file path into the trie with associated metadata.
     * 
     * @param filePath - Absolute path to file
     * @param metadata - File metadata to store at terminal node
     * 
     * @complexity O(L) where L = number of path segments
     * 
     * @throws Error if path is empty or metadata is inconsistent
     * 
     * @example
     * trie.insert('/home/user/file.txt', metadata);
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

        // Mark as terminal node and store metadata
        currentNode.isEndOfPath = true;
        currentNode.metadata = metadata;
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

        const normalized = this.normalizePath(prefix);
        const segments = this.splitPath(normalized);

        let currentNode = this.root;

        // Navigate to the node representing the prefix
        for (const segment of segments) {
            const key = segment.toLowerCase();

            if (!currentNode.children.has(key)) {
                return []; // Prefix doesn't exist
            }

            currentNode = currentNode.children.get(key)!;
        }

        // Collect all paths from this node
        const results: string[] = [];
        this.collectPaths(currentNode, results, maxResults);

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

        return true;
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
     * Get the total number of paths stored in the trie.
     * Used for debugging and testing.
     * 
     * @returns Number of complete paths
     */
    public size(): number {
        let count = 0;

        const countNodes = (node: TrieNode): void => {
            if (node.isEndOfPath) {
                count++;
            }

            for (const child of node.children.values()) {
                countNodes(child);
            }
        };

        countNodes(this.root);
        return count;
    }

    /**
     * Clear all paths from the trie.
     * 
     * IMPLEMENTATION NOTE: We use recursive clearing to explicitly null out
     * all references. While simply creating a new root would be faster and
     * let GC handle cleanup, explicit cleanup is more predictable for
     * memory-sensitive applications and prevents potential memory leaks
     * in linked structures (BUG FIX #4 from architecture review).
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

        // Reinitialize root
        this.root = {
            children: new Map(),
            isEndOfPath: false,
        };
    }
}
