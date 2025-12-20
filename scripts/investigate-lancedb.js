/**
 * LanceDB vectorSearch result inspection
 */
const lancedb = require('@lancedb/lancedb');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

async function inspect() {
    const dbPath = path.join(os.tmpdir(), `lancedb-inspect-${Date.now()}`);

    try {
        await fs.mkdir(dbPath, { recursive: true });
        const db = await lancedb.connect(dbPath);

        const sampleData = [
            {
                id: 'test1',
                chunk_text: 'Machine learning is great',
                vector: new Array(384).fill(0.1),
                file_path: '/test/file.txt',
                chunk_index: 0,
                indexed_at: Date.now(),
            },
            {
                id: 'test2',
                chunk_text: 'Cooking recipes are fun',
                vector: new Array(384).fill(0.5),
                file_path: '/test/file.txt',
                chunk_index: 1,
                indexed_at: Date.now(),
            },
        ];

        const table = await db.createTable('test_table', sampleData);

        // Try vectorSearch
        console.log('=== vectorSearch Result Structure ===');
        const queryVector = new Array(384).fill(0.1);

        const searchBuilder = table.vectorSearch(queryVector);
        console.log('Search builder type:', typeof searchBuilder);
        console.log('Search builder methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(searchBuilder)));

        const results = await searchBuilder.limit(2).toArray();
        console.log('\nResults count:', results.length);
        console.log('First result type:', typeof results[0]);
        console.log('First result keys:', Object.keys(results[0]));
        console.log('First result:', JSON.stringify(results[0], (k, v) => {
            if (Array.isArray(v) && v.length > 10) return `[Array of ${v.length} elements]`;
            return v;
        }, 2));

        // Also test query().nearestTo()
        console.log('\n=== query().nearestTo() Result Structure ===');
        const results2 = await table.query().nearestTo(queryVector).limit(2).toArray();
        console.log('Results count:', results2.length);
        console.log('First result keys:', Object.keys(results2[0]));

        await fs.rm(dbPath, { recursive: true, force: true });
        console.log('\n✓ Done');
    } catch (error) {
        console.error('Error:', error);
        try { await fs.rm(dbPath, { recursive: true, force: true }); } catch { }
    }
}

inspect();
