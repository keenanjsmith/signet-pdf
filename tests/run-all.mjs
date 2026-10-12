// Build the app, serve it, and run every browser test.
// Needs Chromium for Playwright:  npx playwright install chromium
import { spawn, execSync } from 'node:child_process';

const OUT = 'test-results';
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });

run('npm run build');
run('node tests/fixtures.mjs tests/fixtures-out');
const server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
let failed = false;
try {
  run(`node tests/e2e.mjs ${OUT}`);
  run(`node tests/integration.mjs ${OUT}`);
} catch { failed = true; }
finally { server.kill(); }
console.log(failed ? 'Some tests failed.' : `All tests passed. Output PDFs are in ${OUT}/`);
process.exit(failed ? 1 : 0);
