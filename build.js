// build.js
const esbuild = require('esbuild');
const fs = require('fs');

// Ensure dist directory exists
if (!fs.existsSync('./dist')){
    fs.mkdirSync('./dist');
}

esbuild.build({
    entryPoints: ['src/virtualboy.ts'], // Entry point is the main file exporting 'init'
    bundle: true,
    outfile: 'dist/virtualboy.bundle.js',
    platform: 'browser', // Target browser environment
    format: 'iife', // Immediately Invoked Function Expression, good for <script> tags
    globalName: 'Virtualboy', // The library will be accessible via window.Virtualboy
    sourcemap: true, // Include sourcemaps for easier debugging
    minify: false, // Set to true for production builds
    loader: { '.ts': 'ts' }, // Ensure .ts files are handled by the ts loader
}).then(() => {
    console.log("Virtualboy library build complete: dist/virtualboy.bundle.js");
}).catch((e) => {
    console.error("Build failed:", e);
    process.exit(1);
});
