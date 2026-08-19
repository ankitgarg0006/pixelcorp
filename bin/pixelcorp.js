#!/usr/bin/env node
import { startServer } from '../server/index.js';
import { execFile } from 'node:child_process';

const port = Number(process.env.PORT || 4310);
startServer(port).then(() => {
  const url = `http://localhost:${port}`;
  console.log(`\n  🏢 pixelcorp is open at ${url}\n`);
  if (process.platform === 'darwin') execFile('open', [url]);
  else if (process.platform === 'win32') execFile('cmd', ['/c', 'start', url]);
  else execFile('xdg-open', [url]);
});
