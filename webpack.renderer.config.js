/**
 * webpack.renderer.config.js - Webpack Configuration for Renderer Process
 * 
 * Bundles the Electron Renderer process (Browser environment with React).
 * Compiles TypeScript/TSX, processes CSS with Tailwind, and serves dev server.
 */

const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    // Target: Electron renderer process (Browser environment)
    target: 'electron-renderer',

    // Entry point
    entry: './src/renderer/index.tsx',

    // Output configuration
    output: {
        path: path.resolve(__dirname, 'dist/renderer'),
        filename: 'bundle.js',
    },

    // Module resolution
    resolve: {
        extensions: ['.tsx', '.ts', '.js', '.jsx', '.json'],
        alias: {
            '@shared': path.resolve(__dirname, 'src/shared'),
            '@renderer': path.resolve(__dirname, 'src/renderer'),
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
