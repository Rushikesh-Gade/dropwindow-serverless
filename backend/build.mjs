import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const entryPoints = [
  { in: path.join(__dirname, 'createUpload', 'index.mjs'), out: 'createUpload/index' },
  { in: path.join(__dirname, 'getFile', 'index.mjs'), out: 'getFile/index' },
  { in: path.join(__dirname, 'deleteFile', 'index.mjs'), out: 'deleteFile/index' }
];

async function runBuild() {
  console.log('Bundling Lambdas with esbuild (marking @aws-sdk/* external)...');
  await build({
    entryPoints,
    outdir: path.join(__dirname, 'dist'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    minify: true,
    sourcemap: false,
    external: ['@aws-sdk/*']
  });
  console.log('Bundle complete in backend/dist/');
}

runBuild().catch((err) => {
  console.error('Build error:', err);
  process.exit(1);
});
