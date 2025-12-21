/**
 * Ollama Verification Script
 * 
 * Run: node scripts/verify-ollama.js
 * 
 * Purpose: Verify Ollama LLM runtime is installed and running locally.
 * This script checks:
 * 1. Ollama service is accessible on localhost:11434
 * 2. Lists available models
 * 3. Recommends llama3.2 if not found
 * 
 * Required for: Phase 6 LLM Integration (Intelligence Layer)
 */

async function verifyOllama() {
    console.log('🔍 Checking Ollama installation...\n');

    try {
        const response = await fetch('http://localhost:11434/api/tags');

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('✅ Ollama is running on http://localhost:11434');

        // List available models
        const models = data.models || [];
        if (models.length === 0) {
            console.log('\n📦 No models installed yet.');
            console.log('   Run: ollama pull llama3.2');
        } else {
            console.log('\n📦 Available models:');
            models.forEach(m => {
                console.log(`   - ${m.name} (${formatSize(m.size)})`);
            });
        }

        // Check for recommended model
        const hasLlama = models.some(m => m.name.includes('llama3.2'));
        if (!hasLlama) {
            console.log('\n⚠️  Recommended model llama3.2 not found');
            console.log('   Run: ollama pull llama3.2');
        } else {
            console.log('\n✅ llama3.2 model is available');
        }

        console.log('\n🎉 Ollama verification complete!');

    } catch (error) {
        console.error('❌ Ollama is not running or not installed\n');
        console.error('Installation Instructions:');
        console.error('  1. Download: https://ollama.ai/download');
        console.error('  2. Install the downloaded package');
        console.error('  3. Start Ollama: ollama serve');
        console.error('  4. Pull model: ollama pull llama3.2');
        console.error('\nError details:', error.message);
        process.exit(1);
    }
}

/**
 * Format bytes to human-readable size
 */
function formatSize(bytes) {
    if (!bytes) return 'unknown size';
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let size = bytes;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }

    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

// Run verification
verifyOllama();
