import os from 'node:os';
import { createApp } from './app.js';

const PORT = 3000;
const app = createApp({ dataDir: 'data' });

app.listen(PORT, '0.0.0.0', () => {
  console.log('Zebra Connect is running. Open on your phone:');
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) {
        console.log(`  http://${a.address}:${PORT}`);
      }
    }
  }
});
