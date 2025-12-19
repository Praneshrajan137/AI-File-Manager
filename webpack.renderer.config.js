/**
 * webpack.renderer.config.js - Webpack Configuration for Renderer Process
 * 
 * Bundles the Electron Renderer process (Browser environment with React).
 * Compiles TypeScript/TSX, processes CSS with Tailwind, and serves dev server.
 */

const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    // Target: Electron renderer process (Browser environment)
    target: 'electron-renderer',

    // CRITICAL FIX: Prevent webpack from externalizing Node.js modules
    // This forces webpack to bundle the polyfills instead of using require()
    externalsPresets: { node: false },

    // Entry point
    entry: './src/renderer/index.tsx',

    // Output configuration
    output: {
        path: path.resolve(__dirname, 'dist/renderer'),
        filename: 'bundle.js',
        // FIX: Set global object for webpack runtime
        globalObject: 'globalThis',
    },

    // Module resolution
    resolve: {
        extensions: ['.tsx', '.ts', '.js', '.jsx', '.json'],
        alias: {
            '@shared': path.resolve(__dirname, 'src/shared'),
            '@renderer': path.resolve(__dirname, 'src/renderer'),
        },
        fallback: {
            // Polyfills for Node.js core modules in browser
            "path": require.resolve("path-browserify"),
            "os": require.resolve("os-browserify/browser"),
            "events": require.resolve("events/"),
            "buffer": require.resolve("buffer/"),
        },
    },

    // Module rules
    module: {
        rules: [
            // TypeScript/TSX
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                use: {
                    loader: 'ts-loader',
                    options: {
                        configFile: 'tsconfig.json',
                    },
                },
            },

            // CSS with PostCSS (Tailwind)
            {
                test: /\.css$/,
                use: [
                    'style-loader',
                    'css-loader',
                    'postcss-loader',
                ],
            },

            // Images
            {
                test: /\.(png|jpg|jpeg|gif|svg)$/,
                type: 'asset/resource',
            },

            // Fonts
            {
                test: /\.(woff|woff2|eot|ttf|otf)$/,
                type: 'asset/resource',
            },
        ],
    },

    // Plugins
    plugins: [
        new HtmlWebpackPlugin({
            template: './src/renderer/index.html',
            filename: 'index.html',
        }),
        // Fix: Provide Node.js globals for browser environment
        new webpack.ProvidePlugin({
            process: 'process/browser',
            Buffer: ['buffer', 'Buffer'],
        }),
        // Fix: Define global and process.env variables
        new webpack.DefinePlugin({
            'global': 'globalThis',
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
        }),
    ],

    // Development server
    devServer: {
        port: 8080,
        hot: true,
        static: {
            directory: path.join(__dirname, 'dist/renderer'),
        },
        historyApiFallback: true,
    },

    // Mode
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    devtool: process.env.NODE_ENV === 'production' ? false : 'source-map',

    // Performance hints
    performance: {
        hints: false,
    },
};
