import { parentPort } from 'node:worker_threads';
const message = { type: 'archive-reader-ready' };
if (parentPort) parentPort.postMessage(message);
else process.send(message);
setInterval(() => {}, 1000);
