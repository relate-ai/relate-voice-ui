import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets', { recursive: true });
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ['es2022'],
  outfile: 'dist/assets/main.js',
});
await cp('index.html', 'dist/index.html');
await cp('assets/styles.css', 'dist/assets/styles.css');

const indexPath = new URL('dist/index.html', import.meta.url);
const { readFile, writeFile } = await import('node:fs/promises');
const html = (await readFile(indexPath, 'utf8')).replace('/src/main.ts', '/assets/main.js');
await writeFile(indexPath, html);
