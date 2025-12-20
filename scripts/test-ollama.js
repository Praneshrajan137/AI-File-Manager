/**
 * Ollama Service Test Script
 * 
 * Tests Ollama connection, models, and inference.
 */
const OLLAMA_URL = 'http://localhost:11434';

async function testOllama() {
    console.log('🧪 Testing Ollama Service...\n');

    // Test 1: Check if Ollama is running
    console.log('Test 1: Connection Check');
    try {
        const response = await fetch(`${OLLAMA_URL}/api/tags`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        console.log('✅ Ollama is running on localhost:11434\n');
    } catch (error) {
        console.error('❌ Ollama is NOT running');
        console.error('   Error:', error.message);
        console.error('\n📋 To fix:');
        console.error('   1. Install: https://ollama.ai/download');
        console.error('   2. Start: ollama serve');
        console.error('   3. Run this test again\n');
        process.exit(1);
    }

    // Test 2: List available models
    console.log('Test 2: Available Models');
    try {
        const response = await fetch(`${OLLAMA_URL}/api/tags`);
        const data = await response.json();

        if (!data.models || data.models.length === 0) {
            console.warn('⚠️  No models installed');
            console.warn('   Recommended: ollama pull llama3.2\n');
        } else {
            console.log('✅ Models available:');
            data.models.forEach((model) => {
                const sizeGB = (model.size / 1024 / 1024 / 1024).toFixed(1);
                console.log(`   - ${model.name} (${sizeGB}GB)`);
            });
            console.log('');
        }

        // Check for recommended model
        const hasLlama = data.models?.some((m) => m.name.includes('llama'));
        if (!hasLlama) {
            console.warn('⚠️  Recommended model llama3.2 not found');
            console.warn('   Install with: ollama pull llama3.2\n');
        }
    } catch (error) {
        console.error('❌ Failed to list models:', error.message);
    }

    // Test 3: Test inference (if model available)
    console.log('Test 3: Inference Test');
    try {
        const testResponse = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3.2',
                prompt: 'Say "test successful" and nothing else.',
                stream: false,
            }),
        });

        if (!testResponse.ok) {
            const text = await testResponse.text();
            throw new Error(`HTTP ${testResponse.status}: ${text}`);
        }

        const result = await testResponse.json();
        console.log('✅ Inference working');
        console.log('   Response:', result.response.slice(0, 50) + '...\n');
    } catch (error) {
        if (error.message.includes('404') || error.message.includes('model')) {
            console.warn('⚠️  Model not found or not pulled');
            console.warn('   Install: ollama pull llama3.2\n');
        } else {
            console.error('❌ Inference failed:', error.message, '\n');
        }
    }

    // Test 4: Streaming test
    console.log('Test 4: Streaming Test');
    try {
        const streamResponse = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3.2',
                prompt: 'Count to 3.',
                stream: true,
            }),
        });

        if (!streamResponse.ok) {
            throw new Error(`HTTP ${streamResponse.status}`);
        }

        // Just verify we get a readable stream
        const reader = streamResponse.body.getReader();
        const { done, value } = await reader.read();
        reader.cancel();

        if (!done && value) {
            console.log('✅ Streaming working\n');
        }
    } catch (error) {
        console.warn('⚠️  Streaming test skipped:', error.message, '\n');
    }

    console.log('═══════════════════════════════════════');
    console.log('🎉 Ollama Tests Complete!');
    console.log('═══════════════════════════════════════\n');
}

testOllama().catch(console.error);
