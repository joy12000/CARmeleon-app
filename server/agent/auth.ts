import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { ApiError, id, now } from './models';
import type { Account, AuthContext } from './models';
import type { Config } from './config';
import type { Store } from './store';

const Credentials = z.object({ email: z.string().email().max(254).transform(s => s.trim().toLowerCase()), password: z.string().min(12).max(128), deviceName: z.string().max(100).optional() });
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export class Auth {
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(private store: Store, private config: Config) {}
  private rateLimit(key: string) {
    const time = Date.now();
    if (this.attempts.size > 5000) for (const [k, v] of this.attempts) if (v.until < time) this.attempts.delete(k);
    const record = this.attempts.get(key);
    if (record && record.until > time) {
      if (++record.count > 10) throw new ApiError(429, 'AUTH_RATE_LIMIT', '잠시 뒤 다시 로그인해 주세요.');
    } else this.attempts.set(key, { count: 1, until: time + 60_000 });
  }
  async credentials(body: unknown, register: boolean, address: string) {
    this.rateLimit(address);
    const input = Credentials.parse(body);
    if (register && !this.config.allowRegistration) throw new ApiError(403, 'REGISTRATION_DISABLED', '지금은 새 계정 등록을 받지 않아요.');
    const passwordHash = register ? await Bun.password.hash(input.password, { algorithm: 'argon2id', memoryCost: 65536, timeCost: 3 }) : undefined;
    let account: Account;
    if (register) {
      account = { id: id('account'), email: input.email };
      await this.store.raw(async sql => {
        const exists = await sql.unsafe('SELECT id FROM agent_accounts WHERE email=$1', [input.email]);
        if (exists.length) throw new ApiError(409, 'EMAIL_EXISTS', '이미 등록된 이메일이에요.');
        try { await sql.unsafe('INSERT INTO agent_accounts(id,email,password_hash,created_at,updated_at) VALUES($1,$2,$3,$4,$5)', [account.id, account.email, passwordHash!, now(), now()]); }
        catch (error) { if (String(error).includes('UNIQUE') || String(error).includes('unique')) throw new ApiError(409, 'EMAIL_EXISTS', '이미 등록된 이메일이에요.'); throw error; }
      });
    } else {
      const rows = await this.store.raw(sql => sql.unsafe('SELECT id,email,password_hash FROM agent_accounts WHERE email=$1', [input.email]));
      // A fixed dummy hash keeps missing-account paths doing password work, without a mock login.
      const valid = rows[0] ? await Bun.password.verify(input.password, rows[0].password_hash) : (await Bun.password.hash(input.password, { algorithm: 'argon2id', memoryCost: 65536, timeCost: 3 }), false);
      if (!valid) throw new ApiError(401, 'INVALID_CREDENTIALS', '이메일과 비밀번호를 확인해 주세요.');
      account = { id: rows[0].id, email: rows[0].email };
    }
    const accessToken = randomBytes(32).toString('base64url');
    const deviceId = id('device');
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    await this.store.raw(sql => sql.unsafe('INSERT INTO agent_sessions(token_hash,account_id,device_id,expires_at,created_at) VALUES($1,$2,$3,$4,$5)', [tokenHash(accessToken), account.id, deviceId, expiresAt, now()]));
    return { accessToken, expiresAt, account, deviceId };
  }
  async authenticate(request: Request): Promise<AuthContext> {
    const bearer = /^Bearer ([A-Za-z0-9_-]{40,100})$/.exec(request.headers.get('authorization') ?? '');
    if (!bearer) throw new ApiError(401, 'AUTH_REQUIRED', '로그인이 필요해요.');
    const hash = tokenHash(bearer[1]);
    const rows = await this.store.raw(sql => sql.unsafe('SELECT a.id,a.email,s.device_id,s.expires_at FROM agent_sessions s JOIN agent_accounts a ON a.id=s.account_id WHERE s.token_hash=$1', [hash]));
    if (!rows[0] || rows[0].expires_at <= now()) throw new ApiError(401, 'SESSION_EXPIRED', '로그인이 만료됐어요.');
    return { account: { id: rows[0].id, email: rows[0].email }, deviceId: rows[0].device_id, tokenHash: hash };
  }
  async logout(auth: AuthContext) { await this.store.raw(sql => sql.unsafe('DELETE FROM agent_sessions WHERE token_hash=$1 AND account_id=$2', [auth.tokenHash, auth.account.id])); }
}
