import {SQL} from 'bun';

export type AuditEvent = {
  event: 'received' | 'rejected' | 'claimed' | 'claim_denied';
  occurred_at: string; entry_id: string | null; client: string | null;
  service: string | null; channel: string | null; account: string | null;
  capture_method: string | null; received_at: string | null; expires_at: string | null;
  reason: string | null;
};
export type HistoryFilter = {service: string; account: string; channel: string; since: string; before: string; limit: number};
export type AuditStore = {append(event: AuditEvent): Promise<void>; history(filter: HistoryFilter): Promise<any[]>};

export async function createAuditStore(url: string) {
  const sql = new SQL(url, {max: 3, connectionTimeout: 5, connection: {statement_timeout: '5000'}});
  await sql`CREATE TABLE IF NOT EXISTS otp_audit_events (
    id BIGSERIAL PRIMARY KEY, event TEXT NOT NULL, occurred_at TIMESTAMPTZ NOT NULL,
    entry_id TEXT, client TEXT, service TEXT, channel TEXT, account TEXT,
    capture_method TEXT, received_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, reason TEXT
  )`;
  await sql`CREATE INDEX IF NOT EXISTS otp_audit_service_time ON otp_audit_events (service, occurred_at DESC)`;
  return {
    async append(e: AuditEvent) {
      // Explicit columns: never persist the message, preview, code, link or credentials.
      await sql`INSERT INTO otp_audit_events
        (event, occurred_at, entry_id, client, service, channel, account, capture_method, received_at, expires_at, reason)
        VALUES (${e.event}, ${e.occurred_at}, ${e.entry_id}, ${e.client}, ${e.service}, ${e.channel},
          ${e.account}, ${e.capture_method}, ${e.received_at}, ${e.expires_at}, ${e.reason})`;
    },
    async history(f: HistoryFilter) {
      return await sql`SELECT id::text, event, occurred_at, entry_id, client, service, channel, account,
        capture_method, received_at, expires_at, reason FROM otp_audit_events
        WHERE (${f.service} = '' OR service ILIKE ${'%'+f.service+'%'})
          AND (${f.account} = '' OR account = ${f.account})
          AND (${f.channel} = '' OR channel = ${f.channel})
          AND occurred_at >= ${f.since}::timestamptz AND id < ${f.before}::bigint
        ORDER BY id DESC LIMIT ${f.limit + 1}`;
    },
    close: () => sql.close(),
  };
}
