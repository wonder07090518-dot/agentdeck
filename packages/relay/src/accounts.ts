import {
  randomBytes,
  randomInt,
  randomUUID,
  createHash,
  scrypt as derive,
} from "node:crypto";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
const scrypt = promisify(derive);
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
interface Account {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: number;
}
interface Magic {
  email: string;
  codeHash: string;
  salt: string;
  expiresAt: number;
  usedAt?: number;
  purpose?: "login" | "register";
  attempts?: number;
}
interface DeviceToken {
  hash: string;
  accountId: string;
  role: "phone" | "computer";
  deviceId: string;
  createdAt: number;
  revokedAt?: number;
}
interface FailRec {
  count: number;
  start: number;
}
const EMAIL = /^\S+@\S+\.\S+$/;
const FAIL_WINDOW = 60 * 60 * 1000;
const START_COOLDOWN = 60 * 1000;
const MAX_FAILS = 5;
export function accounts(home: string, now: () => number) {
  const file = join(home, "accounts.json");
  const data: { accounts: Account[]; magic: Magic[]; tokens: DeviceToken[] } =
    existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8"))
      : { accounts: [], magic: [], tokens: [] };
  const persist = () => {
    writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
    if (process.platform !== "win32") chmodSync(file, 0o600);
  };
  if (existsSync(file) && process.platform !== "win32") chmodSync(file, 0o600);
  const codes = new Map<string, string>(),
    failures = new Map<string, FailRec>(),
    magicFails = new Map<string, FailRec>();
  const normalize = (s: string) => s.trim().toLowerCase();
  const validEmail = (e: string) => EMAIL.test(e) && e.length <= 254;
  const passwordHash = async (p: string, s: string) =>
    ((await scrypt(p, s, 64)) as Buffer).toString("hex");
  const prune = (map: Map<string, FailRec>) => {
    const t = now();
    for (const [k, v] of map) if (t - v.start >= FAIL_WINDOW) map.delete(k);
  };
  const locked = (map: Map<string, FailRec>, email: string) => {
    prune(map);
    const rec = map.get(email);
    return !!rec && rec.count >= MAX_FAILS;
  };
  const bump = (map: Map<string, FailRec>, email: string) => {
    prune(map);
    const rec = map.get(email);
    if (!rec) map.set(email, { count: 1, start: now() });
    else rec.count++;
  };
  const issue = (accountId: string, role: "phone" | "computer") => {
    const token = randomBytes(32).toString("base64url"),
      deviceId = randomUUID();
    data.tokens.push({
      hash: digest(token),
      accountId,
      role,
      deviceId,
      createdAt: now(),
    });
    persist();
    return { accountId, token, role, deviceId };
  };
  return {
    delete(accountId: string) {
      const a = data.accounts.find((a) => a.id === accountId);
      if (!a) throw Error("这个连接没有账号");
      data.accounts = data.accounts.filter((a) => a.id !== accountId);
      data.tokens = data.tokens.filter((t) => t.accountId !== accountId);
      data.magic = data.magic.filter((m) => m.email !== a.email);
      codes.delete(a.email);
      failures.delete(a.email);
      magicFails.delete(a.email);
      persist();
    },
    issue,
    token: (token: string, role: "phone" | "computer") =>
      data.tokens.find(
        (t) =>
          t.hash === digest(token) &&
          t.role === role &&
          t.revokedAt === undefined,
      ),
    async password(email: string, password: string, register: boolean) {
      email = normalize(email);
      if (!validEmail(email) || password.length < 8 || password.length > 1024) {
        throw Error("邮箱或密码不对");
      }
      if (locked(failures, email)) throw Error("邮箱或密码不对");
      let a = data.accounts.find((a) => a.email === email);
      const salt = a?.salt ?? randomBytes(16).toString("hex");
      let derived = await passwordHash(password, salt);
      const current = data.accounts.find((a) => a.email === email);
      if (current && !a) {
        a = current;
        derived = await passwordHash(password, a.salt);
      }
      if ((!a && !register) || (a && a.passwordHash !== derived)) {
        bump(failures, email);
        throw Error("邮箱或密码不对");
      }
      if (!a) {
        a = {
          id: randomUUID(),
          email,
          passwordHash: derived,
          salt,
          createdAt: now(),
        };
        data.accounts.push(a);
        persist();
      }
      failures.delete(email);
      return a.id;
    },
    async start(email: string, purpose: "login" | "register") {
      email = normalize(email);
      const t = now(),
        expiresAt = t + 600000,
        accountOf = () => data.accounts.find((a) => a.email === email)?.id;
      if (!validEmail(email) || locked(magicFails, email))
        return { code: undefined as string | undefined, expiresAt, accountId: undefined as string | undefined };
      data.magic = data.magic.filter((m) => m.expiresAt > t);
      const existing = data.magic.find(
        (m) => m.email === email && m.usedAt === undefined && m.expiresAt > t,
      );
      if (existing) {
        const last = existing.expiresAt - 600000;
        if (t - last < START_COOLDOWN)
          return {
            code: codes.get(email),
            expiresAt: existing.expiresAt,
            accountId: accountOf(),
          };
      }
      const code = String(randomInt(1000000)).padStart(6, "0"),
        salt = randomBytes(16).toString("hex"),
        codeHash = await passwordHash(code, salt);
      data.magic = data.magic.filter((m) => m.email !== email);
      data.magic.push({ email, codeHash, salt, expiresAt, purpose });
      codes.set(email, code);
      persist();
      return { code, expiresAt, accountId: accountOf() };
    },
    async complete(email: string, code: string) {
      email = normalize(email);
      if (!validEmail(email) || locked(magicFails, email) || code.length > 16) {
        throw Error("验证码无效或已过期");
      }
      const m = data.magic.find((m) => m.email === email);
      let a = data.accounts.find((a) => a.email === email);
      const codeHash = await passwordHash(code, m?.salt ?? "invalid");
      if (
        !m ||
        m.usedAt !== undefined ||
        m.expiresAt <= now() ||
        m.codeHash !== codeHash
      ) {
        bump(magicFails, email);
        if (m) {
          m.attempts = (m.attempts ?? 0) + 1;
          persist();
        }
        throw Error("验证码无效或已过期");
      }
      if (!a && m.purpose !== "register") {
        bump(magicFails, email);
        throw Error("验证码无效或已过期");
      }
      m.usedAt = now();
      codes.delete(email);
      magicFails.delete(email);
      persist();
      if (!a) {
        const salt = randomBytes(16).toString("hex"),
          unusable = await passwordHash(randomBytes(64).toString("hex"), salt);
        a = data.accounts.find((a) => a.email === email);
        if (!a) {
          a = {
            id: randomUUID(),
            email,
            passwordHash: unusable,
            salt,
            createdAt: now(),
          };
          data.accounts.push(a);
          persist();
        }
      }
      return a.id;
    },
    peek: (email: string) => codes.get(normalize(email)),
  };
}
