import 'dotenv/config';
import { createApp } from './app';
import { readConfig } from './config';

async function main() {
  const app = await createApp();
  await app.listen(readConfig().PORT, '0.0.0.0');
}
void main().catch(() => {
  console.error('TonicBridge could not start. Check configuration and database availability.');
  process.exitCode = 1;
});
