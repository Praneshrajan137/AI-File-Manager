/**
 * webpack.main.config.js - Webpack Configuration for Main Process
 * 
 * Bundles the Electron Main process (Node.js environment).
 * Compiles TypeScript to JavaScript and handles all Main process dependencies.
 */

const path = require('path');

module.exports = {
    // Target: Electron main process (Node.js environment)
    target: 'electron-main',

    // Entry points: main process, preload script, and workers
    entry: {
        main: './src/main/main.ts',
        preload: './src/main/preload.ts',
        embeddingWorker: './src/llm/workers/embeddingWorker.ts',
    },

    // Output configuration
    output: {
        path: path.resolve(__dirname, 'dist/main'),
        filename: '[name].js',  // Creates main.js and preload.js
    },

    // Module resolution
    resolve: {
        extensions: ['.ts', '.js', '.json'],
        alias: {
            '@shared': path.resolve(__dirname, 'src/shared'),
            '@main': path.resolve(__dirname, 'src/main'),
        },
    },

    // Module rules
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: 'tsconfig.json',
                    },
                },
            },
        ],
    },

    // Node configuration (important for Electron)
    node: {
        __dirname: false,
        __filename: false,
    },

    // Externals: Don't bundle Node.js built-ins, Electron, or native modules
    externals: {
        electron: 'commonjs electron',
        // Native modules that can't be bundled by webpack
        '@lancedb/lancedb': 'commonjs @lancedb/lancedb',
        // NOTE: @xenova/transformers uses dynamicImport helper to bypass webpack
        '@xenova/transformers': 'commonjs @xenova/transformers',
        'sharp': 'commonjs sharp',
        'chokidar': 'commonjs chokidar',
        'ollama': 'commonjs ollama',
        // Winston and its file transport have native deps
        'winston': 'commonjs winston',
        'winston-daily-rotate-file': 'commonjs winston-daily-rotate-file',
    },

    // Development configuration
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    devtool: process.env.NODE_ENV === 'production' ? false : 'source-map',

    // Performance hints
    performance: {
        hints: false,
    },
};
