#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import process from 'node:process';

const origin = process.env.OPENXTF_URL || 'http://localhost:3000';
const port = Number(process.env.GECKODRIVER_PORT || 4447);
const driverOrigin = `http://127.0.0.1:${port}`;
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
      `WebDriver ${method} ${pathname} failed (${response.status}): ${JSON.stringify(payload).slice(0, 800)}`,
    );
  }
  return payload.value;
}

async function waitForDriver() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${driverOrigin}/status`)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`geckodriver did not start.\n${driverLog.slice(-1200)}`);
}

const execute = (script, args = []) =>
  webdriver('POST', `/session/${sessionId}/execute/sync`, { script, args });

async function waitFor(label, predicate, attempts = 180) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await execute(`return (${predicate})();`);
    if (value) return value;
    await sleep(500);
  }
  throw new Error(`${label}: timed out`);
}

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

  await waitFor(
    'hydrated Korean-first page',
    `() => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === '표준 XTFont')`,
  );
  await execute(`
    const button = [...document.querySelectorAll('button')]
      .find((item) => item.textContent.trim() === '표준 XTFont');
    button.click();
    return true;
  `);

  const standard = await waitFor(
    'firmware-backed Standard X4 preview',
    `() => {
      const text = document.body.innerText;
      const image = document.querySelector('.preview-image-button img');
      const pattern = [...document.querySelectorAll('input[type=text]')]
        .some((input) => input.value === '[fontsize]_[fontname].xtf');
      const cell = [...document.querySelectorAll('.build-summary strong')]
        .map((node) => node.textContent.trim())
        .find((value) => /^\\d+×\\d+$/.test(value));
      return image && image.naturalWidth === 480 && image.naturalHeight === 800 &&
        text.includes('현재 공식 XTFont Maker와 같은 기본값') &&
        text.includes('X4 시리즈 · 480×800') &&
        text.includes('X3 시리즈 · 528×792') &&
        text.includes('X4 V6.3.15 방식') && pattern && cell && cell !== '39×38'
        ? { width: image.naturalWidth, height: image.naturalHeight, cell }
        : null;
    }`,
  );
  assert.deepEqual(
    { width: standard.width, height: standard.height },
    { width: 480, height: 800 },
  );

  await execute(`
    const button = [...document.querySelectorAll('button')]
      .find((item) => item.textContent.trim() === 'X3 시리즈 · 528×792');
    button.click();
    return true;
  `);
  const x3 = await waitFor(
    'official X3 preview branch',
    `() => {
      const text = document.body.innerText;
      const image = document.querySelector('.preview-image-button img');
      return image && image.naturalWidth === 528 && image.naturalHeight === 792 &&
        text.includes('X3는 현재 공식 XTFont Maker의 레이아웃 미리보기') &&
        !text.includes('기기 레이아웃 설정')
        ? { width: image.naturalWidth, height: image.naturalHeight }
        : null;
    }`,
  );
  assert.deepEqual(x3, { width: 528, height: 792 });

  process.stdout.write(
    `PASS Standard browser state ${standard.cell}, X4 ${standard.width}×${standard.height}, X3 ${x3.width}×${x3.height}\n`,
  );
} finally {
  if (sessionId) {
    await webdriver('DELETE', `/session/${sessionId}`).catch(() => {});
  }
  driver.kill('SIGTERM');
}
