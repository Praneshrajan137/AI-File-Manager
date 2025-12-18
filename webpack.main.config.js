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

    // Entry point
    entry: './src/main/main.ts',

    // Output configuration
    output: {
        path: path.resolve(__dirname, 'dist/main'),
        filename: 'main.js',
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

    // Externals: Don't bundle Node.js built-ins or Electron
    externals: {
        electron: 'commonjs electron',
    },

    // Development configuration
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    devtool: process.env.NODE_ENV === 'production' ? false : 'source-map',

    // Performance hints
    performance: {
        hints: false,
    },
};
