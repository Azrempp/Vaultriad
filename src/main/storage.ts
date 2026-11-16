import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
export async function atomicWrite(
  path: string,
  data: string | Buffer,
  rolling = false,
) {
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (rolling) {
      try {
        await atomicWrite(`${path}.previous`, await fs.readFile(path));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    await fs.rename(temporary, path);
    // Persist directory metadata on platforms that support directory fsync.
    try {
      const dir = await fs.open(dirname(path), "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } catch {}
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
}
export async function readLimited(path: string) {
  const stat = await fs.stat(path);
  if (stat.size > 80 * 1024 * 1024)
    throw Error("File exceeds the 80 MB safety limit.");
  return fs.readFile(path, "utf8");
}
