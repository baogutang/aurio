import { flushSave } from './store.js';
import { station } from './playout/station.js';
import { stopScheduler } from './scheduler.js';
import { drainDj } from './dj.js';

let serverInstance = null;
let wssInstance = null;
let shuttingDown = false;

export function registerServer(server, wss) {
  serverInstance = server;
  wssInstance = wss;
}

export async function stopServer({ timeoutMs = 8000 } = {}) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    station.stop();
    stopScheduler();
    await drainDj(timeoutMs);
    flushSave();
    if (wssInstance) {
      for (const ws of wssInstance.clients) {
        try { ws.close(1001, 'server shutting down'); } catch { /* noop */ }
      }
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        wssInstance.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    if (serverInstance) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        serverInstance.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    flushSave();
  } finally {
    serverInstance = null;
    wssInstance = null;
    shuttingDown = false;
  }
}

export function installSignalHandlers() {
  const onSignal = () => {
    stopServer().finally(() => process.exit(0));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
}
