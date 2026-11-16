import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { join } from "node:path";
const load = createRequire(
  typeof __filename === "string"
    ? __filename
    : join(process.cwd(), "package.json"),
);
// This static worker runs in the main-process trust boundary, never in a renderer.
// Argon2 WASM otherwise blocks the event loop and delays system-lock handling.
const deriveWorker = `
const {parentPort, workerData} = require('node:worker_threads');
const {argon2id} = require(workerData.modulePath);
(async () => {
 const password = workerData.password;
 try {
  const key = await argon2id({password, salt: Buffer.from(workerData.salt, 'hex'), parallelism:1, iterations:3, memorySize:65536, hashLength:32, outputType:'binary'});
  parentPort.postMessage(key, [key.buffer]);
 } catch { parentPort.postMessage({error:true}); }
 finally {password.fill(0);}
})();
`;
import { z } from "zod";
import type { Credentials, Factors, Vault } from "../shared/types";
export const factorSchema = z
  .object({
    password: z.boolean(),
    pin: z.boolean(),
    questions: z.array(z.string().max(200)).max(3),
    bound: z.boolean(),
  })
  .strict();
const envelopeSchema = z
  .object({
    magic: z.literal("VAULTRIAD"),
    version: z.literal(1),
    kdf: z.literal("argon2id-64m-t3-p1"),
    salt: z.string().regex(/^[a-f0-9]{32}$/),
    nonce: z.string().regex(/^[a-f0-9]{24}$/),
    factors: factorSchema,
    tag: z.string().regex(/^[a-f0-9]{32}$/),
    data: z.string().max(64 * 1024 * 1024),
  })
  .strict();
export type Envelope = z.infer<typeof envelopeSchema>;
export function normalizeAnswer(s: string) {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim()
    .replace(/\s+/g, " ");
}
export function validateFactors(f: Factors, c: Credentials) {
  if (!f.password && !f.pin && !f.questions.length)
    throw Error("Choose at least one credential group.");
  if (
    f.questions.length &&
    (f.questions.length !== 3 || new Set(f.questions).size !== 3)
  )
    throw Error("Choose three different questions.");
  if (f.password && !c.password.length)
    throw Error("Enter your master password.");
  if (f.pin && !/^\d{6,12}$/.test(c.pin))
    throw Error("PIN must contain 6–12 digits.");
  if (
    f.questions.length &&
    (c.answers.length !== 3 || c.answers.some((a) => !normalizeAnswer(a)))
  )
    throw Error("Answer all three questions.");
}
export async function derive(
  c: Credentials,
  f: Factors,
  salt: string,
  binding?: Buffer,
): Promise<Buffer> {
  if (f.bound && !binding)
    throw Error("This vault is bound to its original computer.");
  const material = Buffer.from(
    JSON.stringify([
      f.password ? c.password : null,
      f.pin ? c.pin : null,
      f.questions.length ? c.answers.map(normalizeAnswer) : null,
      f.bound ? binding!.toString("base64") : null,
    ]),
  );
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      const worker = new Worker(deriveWorker, {
        eval: true,
        workerData: {
          modulePath: load.resolve("hash-wasm"),
          password: material,
          salt,
        },
      });
      const timeout = setTimeout(() => {
        void worker.terminate();
        reject(Error("Key derivation timed out."));
      }, 30000);
      worker.once("message", (message: Uint8Array | { error: true }) => {
        clearTimeout(timeout);
        if (message instanceof Uint8Array) {
          const key = Buffer.from(message);
          message.fill(0);
          resolve(key);
        } else reject(Error("Key derivation failed."));
        void worker.terminate();
      });
      worker.once("error", () => {
        clearTimeout(timeout);
        reject(Error("Key derivation failed."));
      });
      worker.once("exit", (code) => {
        clearTimeout(timeout);
        reject(Error("Key derivation interrupted."));
      });
    });
  } finally {
    material.fill(0);
  }
}
function aad(
  e: Pick<Envelope, "magic" | "version" | "kdf" | "salt" | "nonce" | "factors">,
) {
  return Buffer.from(
    JSON.stringify({
      magic: e.magic,
      version: e.version,
      kdf: e.kdf,
      salt: e.salt,
      nonce: e.nonce,
      factors: e.factors,
    }),
  );
}
export function encrypt(
  v: Vault,
  key: Buffer,
  factors: Factors,
  salt: string,
): Envelope {
  const base = {
    magic: "VAULTRIAD" as const,
    version: 1 as const,
    kdf: "argon2id-64m-t3-p1" as const,
    salt,
    nonce: randomBytes(12).toString("hex"),
    factors,
  };
  const cipher = createCipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(base.nonce, "hex"),
  );
  cipher.setAAD(aad(base));
  const plain = Buffer.from(JSON.stringify(v));
  try {
    return {
      ...base,
      data: Buffer.concat([cipher.update(plain), cipher.final()]).toString(
        "base64",
      ),
      tag: cipher.getAuthTag().toString("hex"),
    };
  } finally {
    plain.fill(0);
  }
}
export function parseEnvelope(raw: string): Envelope {
  return envelopeSchema.parse(JSON.parse(raw));
}
export function decrypt(e: Envelope, key: Buffer): Vault {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(e.nonce, "hex"),
  );
  decipher.setAAD(aad(e));
  decipher.setAuthTag(Buffer.from(e.tag, "hex"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(e.data, "base64")),
    decipher.final(),
  ]);
  try {
    const v = JSON.parse(plain.toString());
    if (v.version !== 1 || !Array.isArray(v.entries) || !v.preferences)
      throw Error("Unsupported vault format.");
    return v;
  } finally {
    plain.fill(0);
  }
}
export function backupMAC(payload: string, key: Buffer) {
  return createHmac("sha256", key)
    .update("VAULTRIAD-BACKUP-v1\0")
    .update(payload)
    .digest("hex");
}
export function createBackup(e: Envelope, key: Buffer) {
  const payload = JSON.stringify(e);
  return JSON.stringify({
    magic: "VAULTRIAD-BACKUP",
    version: 1,
    payload,
    mac: backupMAC(payload, key),
  });
}
export function parseBackup(raw: string) {
  const b = z
    .object({
      magic: z.literal("VAULTRIAD-BACKUP"),
      version: z.literal(1),
      payload: z.string().max(70 * 1024 * 1024),
      mac: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict()
    .parse(JSON.parse(raw));
  return { ...b, envelope: parseEnvelope(b.payload) };
}
export function verifyBackup(b: ReturnType<typeof parseBackup>, key: Buffer) {
  if (
    !timingSafeEqual(
      Buffer.from(b.mac, "hex"),
      Buffer.from(backupMAC(b.payload, key), "hex"),
    )
  )
    throw Error(
      "Backup integrity check failed. The file may be modified, or the credentials are incorrect.",
    );
}
