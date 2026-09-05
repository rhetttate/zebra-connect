import net from 'node:net';
import os from 'node:os';

export function sendToPrinter(ip, data, { port = 9100, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: ip, port });
    const fail = (why) => {
      sock.destroy();
      reject(new Error(`Can't reach printer at ${ip}:${port} (${why})`));
    };
    sock.setTimeout(timeoutMs, () => fail('timeout'));
    sock.on('error', (err) => fail(err.code ?? err.message));
    sock.on('connect', () => sock.end(data));
    sock.on('close', (hadError) => { if (!hadError) resolve(); });
  });
}

export function probe(ip, { port = 9100, timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: ip, port });
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.on('error', () => done(false));
    sock.on('connect', () => done(true));
  });
}

export async function discoverPrinters({ port = 9100 } = {}) {
  const prefixes = new Set();
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        prefixes.add(a.address.split('.').slice(0, 3).join('.'));
      }
    }
  }
  const targets = [...prefixes].flatMap((p) =>
    Array.from({ length: 254 }, (_, i) => `${p}.${i + 1}`));
  const found = [];
  const CONCURRENCY = 64;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((ip) => probe(ip, { port })));
    results.forEach((ok, j) => { if (ok) found.push(batch[j]); });
  }
  return found;
}
