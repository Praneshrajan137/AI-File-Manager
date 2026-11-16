/**
 * webpack.renderer.config.js - Webpack Configuration for Renderer Process
 * 
 * Bundles the Electron Renderer process (Browser environment with React).
 * Compiles TypeScript/TSX, processes CSS with Tailwind, and serves dev server.
 */

const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env, argv) => {
    const isProduction = argv?.mode === 'production' || process.env.NODE_ENV === 'production';

    return {
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
            chunkFilename: '[name].chunk.js',
            publicPath: './',
            // FIX: Set global object for webpack runtime
            globalObject: 'globalThis',
            chunkFormat: 'array-push',
            chunkLoading: 'jsonp',
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
                // TypeScript/TSX compiled with ESNext modules for tree-shaking & async lazy chunks
                {
                    test: /\.tsx?$/,
                    exclude: /node_modules/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            configFile: 'tsconfig.renderer.json',
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
            // Let webpack `mode` control process.env.NODE_ENV cleanly without DefinePlugin conflict
            new webpack.DefinePlugin({
                'global': 'globalThis',
            }),
        ],

        // Split async dynamic chunks cleanly while keeping initial entry lean
        optimization: {
            splitChunks: {
                chunks: 'async',
                minSize: 10000,
            },
        },

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
        mode: isProduction ? 'production' : 'development',
        devtool: isProduction ? false : 'source-map',

        // Performance hints
        performance: {
            hints: false,
        },
    };
};
