import 'dotenv/config';
import { createApp } from './app.ts';

const { app, close } = createApp();
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const server = app.listen(port, host, () => {
  console.log(`EmotiStudio API ready at http://${host}:${port}`);
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  // Drain in-flight request handlers before closing their shared database connection.
  const forceConnectionsClosed = setTimeout(() => server.closeAllConnections(), 10_000);
  forceConnectionsClosed.unref();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  clearTimeout(forceConnectionsClosed);
  await close();
  console.log('EmotiStudio stopped; active image jobs and database safely closed.');
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
