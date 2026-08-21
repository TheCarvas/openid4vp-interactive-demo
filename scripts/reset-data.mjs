import { rm } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const configured = process.env.DATA_DIR?.trim();
const dataDirectory = configured
  ? (isAbsolute(configured) ? resolve(configured) : resolve(process.cwd(), configured))
  : resolve(process.cwd(), '.data');

const files = [
  resolve(dataDirectory, 'accounts.json'),
  resolve(dataDirectory, 'activity.json'),
  resolve(dataDirectory, 'diagnostic-traces'),
];
await Promise.all(files.map((file) => rm(file, { recursive: true, force: true })));
console.log(`Reset demo user, activity, and diagnostic trace data:\n${files.join('\n')}`);
