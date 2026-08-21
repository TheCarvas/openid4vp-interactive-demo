import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readJsonArray<T>(filePath: string, storeName: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  if (!text.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${storeName} contains invalid JSON. Clear or repair the datastore file.`, {
      cause: error,
    });
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${storeName} must contain a JSON array.`);
  }
  return parsed as T[];
}

export async function writeJsonArrayAtomically<T>(filePath: string, values: T[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryFile = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryFile, `${JSON.stringify(values, null, 2)}\n`, 'utf8');
    await rename(temporaryFile, filePath);
  } finally {
    await rm(temporaryFile, { force: true }).catch(() => undefined);
  }
}
