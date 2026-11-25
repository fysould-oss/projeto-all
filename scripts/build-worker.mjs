import { copyFile, mkdir } from 'node:fs/promises';

const directory = new URL('../dist/server/', import.meta.url);
await mkdir(directory, { recursive: true });
await copyFile(new URL('../worker/index.mjs', import.meta.url), new URL('index.js', directory));
