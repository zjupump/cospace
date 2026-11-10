import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Member } from "../lib/types";
import type { Database } from "./database";
import { ensure } from "./errors";
import { verifyPassword } from "./passwords";

export const sessionCookie = "cospace_session";
export const sessionSeconds = 60 * 60 * 24 * 7;
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const loginInput = z.object({ email: z.string().trim().toLowerCase().email().max(254), password: z.string().min(1).max(256) });

export async function login(database: Database, input: unknown) {
  const data = loginInput.parse(input);
  const now = new Date();
  await database.transaction(async (transaction) => {
    await transaction.query("INSERT INTO login_attempts (email,failures,reset_at) VALUES ($1,0,$2) ON CONFLICT DO NOTHING", [data.email, new Date(now.getTime() + 900000).toISOString()]);
    const [attempt] = await transaction.query<{ failures: number; reset_at: string }>("SELECT * FROM login_attempts WHERE email=$1 FOR UPDATE", [data.email]);
    if (attempt.reset_at <= now.toISOString()) {
      await transaction.query("UPDATE login_attempts SET failures=1,reset_at=$2 WHERE email=$1", [data.email, new Date(now.getTime() + 900000).toISOString()]);
    } else {
      ensure(attempt.failures < 10, 429, "尝试次数过多，请 15 分钟后重试");
      await transaction.query("UPDATE login_attempts SET failures=failures+1 WHERE email=$1", [data.email]);
    }
  });
  const [member] = await database.query<Member & { password_hash: string }>("SELECT * FROM members WHERE email=$1", [data.email]);
  const dummy = "00000000000000000000000000000000:" + "0".repeat(128);
  const valid = await verifyPassword(data.password, member?.password_hash || dummy);
  ensure(member && valid, 401, "邮箱或密码不正确");
  const token = randomBytes(32).toString("hex");
  await database.transaction(async (transaction) => {
    await transaction.query("DELETE FROM sessions WHERE expires_at <= $1", [now.toISOString()]);
    await transaction.query("DELETE FROM login_attempts WHERE email=$1", [data.email]);
    await transaction.query("INSERT INTO sessions (token_hash,member_id,expires_at) VALUES ($1,$2,$3)", [digest(token), member.id, new Date(now.getTime() + sessionSeconds * 1000).toISOString()]);
  });
  return token;
}

export async function authenticate(database: Database, token?: string): Promise<Member> {
  ensure(token && /^[a-f0-9]{64}$/.test(token), 401, "请先登录工作区");
  const [member] = await database.query<Member>("SELECT members.id,members.workspace_id,members.name,members.email,members.role FROM members JOIN sessions ON sessions.member_id=members.id WHERE sessions.token_hash=$1 AND sessions.expires_at>$2", [digest(token), new Date().toISOString()]);
  ensure(member, 401, "登录已过期，请重新登录");
  return member;
}

export async function logout(database: Database, token?: string) {
  if (token) await database.query("DELETE FROM sessions WHERE token_hash=$1", [digest(token)]);
}
