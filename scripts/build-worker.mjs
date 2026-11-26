import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const directory = new URL('../dist/server/', import.meta.url);
await mkdir(directory, { recursive: true });
await copyFile(new URL('../worker/index.mjs', import.meta.url), new URL('index.js', directory));
await copyFile(new URL('../worker/remote.mjs', import.meta.url), new URL('remote.mjs', directory));
const privateTextAssets = {};
for (const name of ['index.html', 'app.js', 'online.js', 'rules.js', 'style.css', 'projects.json', 'progress.json']) {
  privateTextAssets[name] = await readFile(new URL('../dist/' + name, import.meta.url), 'utf8');
}
await writeFile(new URL('private-assets.mjs', directory),
  'export const privateTextAssets = ' + JSON.stringify(privateTextAssets) + ';\n');
