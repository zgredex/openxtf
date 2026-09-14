#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const project = path.resolve(import.meta.dirname, '..');
const research = path.resolve(project, '..', 'xtfont-research');
const origin = process.env.OPENXTF_URL || 'http://127.0.0.1:3000';
const port = Number(process.env.GECKODRIVER_PORT || 4445);
const driverOrigin = `http://127.0.0.1:${port}`;
const workerPath =
  process.env.OPENXTF_WORKER_PATH || '/assets/xtfont.worker-DNIsIZBe.js';
const currentOfficialWorkerSha256 =
  '8a7d2251e9ec6d3e722be5a48528e936771ff49e5a35b226400e7c8503e3f38d';
const font = fs.readFileSync(
  path.join(research, 'samples', 'input', 'ABeeZee-Regular.ttf'),
).toString('base64');
const fixtureDirs = [
  'F1_xtf_2bpp',
  'F2_xtf_1bpp',
  'F3_xtf_spacing',
  'F4_bin',
];
const fixtures = fixtureDirs.map((name) =>
  JSON.parse(
    fs.readFileSync(
      path.join(research, 'samples', 'output', name, 'fixture.json'),
      'utf8',
    ),
  ),
);

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

let sessionId;
let driverLog = '';

const driver = spawn(process.env.GECKODRIVER || 'geckodriver', [
  '--host',
  '127.0.0.1',
  '--port',
  String(port),
]);
driver.stdout.on('data', (chunk) => {
  driverLog += chunk;
});
driver.stderr.on('data', (chunk) => {
  driverLog += chunk;
});

async function webdriver(method, pathname, body) {
  const response = await fetch(`${driverOrigin}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `WebDriver ${method} ${pathname} failed (${response.status}): ${JSON.stringify(payload).slice(0, 600)}`,
    );
  }
  return payload.value;
}

async function waitForDriver() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${driverOrigin}/status`);
      if (response.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`geckodriver did not start.\n${driverLog.slice(-1200)}`);
}

const execute = (script, args = []) =>
  webdriver('POST', `/session/${sessionId}/execute/sync`, { script, args });

async function waitForJob(label) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    await sleep(500);
    const status = await execute(
      'return window.__openxtfCompatibilityJob || null;',
    );
    if (status?.status === 'done') return status;
    if (status?.status === 'error') throw new Error(`${label}: ${status.error}`);
  }
  throw new Error(`${label}: timed out`);
}

const kickoff = `
  const [fontBase64, options, workerPath] = arguments;
  window.__openxtfCompatibilityJob = { status: 'running' };
  (async () => {
    let worker;
    try {
      const fontBytes = Uint8Array.from(atob(fontBase64), (char) => char.charCodeAt(0));
      const fontFile = new File([fontBytes], 'ABeeZee-Regular.ttf', { type: 'font/ttf' });
      worker = new Worker(workerPath, { type: 'module' });
      let requestId = 0;
      const request = (type, payload) => new Promise((resolve, reject) => {
        const id = ++requestId;
        const onMessage = (event) => {
          if (!event.data || event.data.requestId !== id) return;
          if (event.data.type === 'progress') return;
          worker.removeEventListener('message', onMessage);
          if (event.data.type === 'result') resolve(event.data.result);
          else reject(new Error(event.data.error?.message || 'worker error'));
        };
        worker.addEventListener('message', onMessage);
        worker.postMessage({ type, requestId: id, payload });
      });
      const probe = await request('probe', {});
      if (!probe?.supported) throw new Error('worker capability gate failed');
      const result = await request('build', {
        options: { ...options, fontFile, fallbackFiles: [] },
      });
      const bytes = new Uint8Array(result.bytes);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const sha256 = [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      window.__openxtfCompatibilityJob = {
        status: 'done',
        sha256,
        bytes: bytes.byteLength,
        fileName: result.fileName,
        summary: result.summary,
      };
    } catch (error) {
      window.__openxtfCompatibilityJob = { status: 'error', error: String(error) };
    } finally {
      worker?.terminate();
    }
  })();
`;

try {
  await waitForDriver();
  const session = await webdriver('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        browserName: 'firefox',
        'moz:firefoxOptions': {
          args: ['-headless'],
          ...(process.env.FIREFOX_BINARY
            ? { binary: process.env.FIREFOX_BINARY }
            : {}),
        },
      },
    },
  });
  sessionId = session.sessionId;
  await webdriver('POST', `/session/${sessionId}/url`, { url: origin });

  const workerSha = await execute(`
    return (async () => {
      const bytes = await (await fetch(${JSON.stringify(workerPath)})).arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    })();
  `);
  const expectedWorkerSha =
    process.env.OPENXTF_WORKER_SHA256 ||
    (workerPath.endsWith('/xtfont.worker-DNIsIZBe.js')
      ? currentOfficialWorkerSha256
      : fixtures[0].workerSha256);
  if (workerSha !== expectedWorkerSha) {
    throw new Error(`worker SHA mismatch: ${workerSha} != ${expectedWorkerSha}`);
  }

  for (const fixture of fixtures) {
    await execute('window.__openxtfCompatibilityJob = null;');
    await execute(kickoff, [font, fixture.settings, workerPath]);
    const actual = await waitForJob(fixture.row);
    const failures = [];
    if (actual.sha256 !== fixture.sha256) {
      failures.push(`SHA ${actual.sha256} != ${fixture.sha256}`);
    }
    if (actual.bytes !== fixture.bytes) {
      failures.push(`bytes ${actual.bytes} != ${fixture.bytes}`);
    }
    if (actual.fileName !== fixture.expectedFileName) {
      failures.push(`filename ${actual.fileName} != ${fixture.expectedFileName}`);
    }
    if (failures.length) {
      throw new Error(`${fixture.row}: ${failures.join('; ')}`);
    }
    process.stdout.write(
      `PASS ${fixture.row} ${actual.bytes} bytes ${actual.sha256}\n`,
    );
  }
  process.stdout.write(`PASS worker ${workerSha}\n`);
} finally {
  if (sessionId) {
    await webdriver('DELETE', `/session/${sessionId}`).catch(() => {});
  }
  driver.kill('SIGTERM');
}
