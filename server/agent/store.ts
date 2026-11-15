import { SQL } from 'bun';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ApiError, now } from './models';
import type { Config } from './config';

export type SqlClient = { unsafe(query: string, values?: unknown[]): Promise<any[]> };
export class Records {
  constructor(readonly sql: SqlClient, readonly accountId: string) {}
  async get<T>(kind: string, recordId: string): Promise<T | undefined> {
    const rows = await this.sql.unsafe('SELECT data FROM agent_records WHERE account_id=$1 AND kind=$2 AND id=$3', [this.accountId, kind, recordId]);
    return rows[0] ? JSON.parse(rows[0].data) : undefined;
  }
  async list<T>(kind: string): Promise<T[]> {
    const rows = await this.sql.unsafe('SELECT data FROM agent_records WHERE account_id=$1 AND kind=$2 ORDER BY updated_at DESC', [this.accountId, kind]);
    return rows.map(row => JSON.parse(row.data));
  }
  async put(kind: string, recordId: string, value: unknown) {
    await this.sql.unsafe('INSERT INTO agent_records(account_id,kind,id,data,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,kind,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at', [this.accountId, kind, recordId, JSON.stringify(value), now()]);
  }
  async remove(kind: string, recordId: string) {
    await this.sql.unsafe('DELETE FROM agent_records WHERE account_id=$1 AND kind=$2 AND id=$3', [this.accountId, kind, recordId]);
  }
}

/** Every DB read uses a transaction, including SQLite, to avoid reads joining another account's open transaction. */
export class Store {
  readonly db: SQL;
  constructor(readonly config: Config) {
    this.db = config.databaseUrl ? new SQL(config.databaseUrl) : new SQL({ adapter: 'sqlite', filename: join(config.dataDir, 'agent.sqlite') });
  }
  static async open(config: Config) {
    await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
    const store = new Store(config);
    await store.db.unsafe('CREATE TABLE IF NOT EXISTS agent_accounts (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)');
    await store.db.unsafe('CREATE TABLE IF NOT EXISTS agent_sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, device_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)');
    await store.db.unsafe('CREATE INDEX IF NOT EXISTS agent_sessions_account ON agent_sessions(account_id)');
    await store.db.unsafe('CREATE TABLE IF NOT EXISTS agent_records (account_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(account_id,kind,id))');
    await store.db.unsafe('CREATE TABLE IF NOT EXISTS agent_operations (account_id TEXT NOT NULL, id TEXT NOT NULL, input_hash TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(account_id,id))');
    return store;
  }
  async raw<T>(operation: (sql: SqlClient) => Promise<T>): Promise<T> {
    return this.db.begin(async sql => operation(sql as unknown as SqlClient)) as Promise<T>;
  }
  async read<T>(accountId: string, operation: (records: Records) => Promise<T>): Promise<T> {
    return this.raw(sql => operation(new Records(sql, accountId)));
  }
  async write<T>(accountId: string, operation: (records: Records) => Promise<T>): Promise<T> {
    return this.raw(async sql => {
      // Row lock on PostgreSQL; write lock on SQLite. Lock before reading revisions.
      const found = await sql.unsafe('UPDATE agent_accounts SET updated_at=updated_at WHERE id=$1 RETURNING id', [accountId]);
      if (!found.length) throw new ApiError(401, 'ACCOUNT_UNAVAILABLE', '계정에 다시 로그인해 주세요.');
      return operation(new Records(sql, accountId));
    });
  }
  async mutate<T>(accountId: string, operationId: string, input: unknown, operation: (records: Records) => Promise<T>): Promise<T> {
    const inputHash = digest(input);
    return this.write(accountId, async records => {
      const previous = await records.sql.unsafe('SELECT input_hash,result FROM agent_operations WHERE account_id=$1 AND id=$2', [accountId, operationId]);
      if (previous[0]) {
        if (previous[0].input_hash !== inputHash) throw new ApiError(409, 'OPERATION_REUSED', '같은 작업 ID를 다른 내용으로 사용할 수 없어요.');
        return JSON.parse(previous[0].result);
      }
      const result = await operation(records);
      await records.sql.unsafe('INSERT INTO agent_operations(account_id,id,input_hash,result,created_at) VALUES($1,$2,$3,$4,$5)', [accountId, operationId, inputHash, JSON.stringify(result), now()]);
      return result;
    });
  }
  async close() { await this.db.close(); }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const bytesHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
