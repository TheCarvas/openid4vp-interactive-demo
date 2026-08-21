import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const files = [
  resolve(process.cwd(), '.data', 'accounts.json'),
  resolve(process.cwd(), '.data', 'activity.json'),
  resolve(process.cwd(), '.data', 'diagnostic-traces'),
];
await Promise.all(files.map((file) => rm(file, { recursive: true, force: true })));
console.log(`Reset demo user, activity, and diagnostic trace data:\n${files.join('\n')}`);
