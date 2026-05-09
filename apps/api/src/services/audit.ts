// ============================================================
// SimpleBuild Pro — Audit Log Service
// Automatic tracking of all security-relevant actions
// Phase 5.1b: Enterprise audit trail
// ============================================================

import { getDb } from '@simplebuildpro/db';
import { sql } from 'drizzle-orm';
import { logger } from './logger';

// ─── Audit Event Types ───────────────────────────────────────────────────────
export type AuditAction =
  // Auth events
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.signup'
  | 'auth.password_change'
  | 'auth.password_reset'
  | 'auth.mfa_enable'
  | 'auth.mfa_disable'
  | 'auth.token_refresh'
  | 'auth.sso_login'
  // Project events
  | 'project.create'
  | 'project.update'
  | 'project.delete'
  | 'project.archive'
  // File events
  | 'file.create'
  | 'file.update'
  | 'file.delete'
  // Deploy events
  | 'deploy.start'
  | 'deploy.success'
  | 'deploy.failed'
  | 'deploy.rollback'
  // Billing events
  | 'billing.payment_method_add'
  | 'billing.payment_method_remove'
  | 'billing.credits_purchase'
  | 'billing.promo_code_redeem'
  | 'billing.plan_change'
  // Org events
  | 'org.create'
  | 'org.update'
  | 'org.member_invite'
  | 'org.member_join'
  | 'org.member_remove'
  | 'org.member_role_change'
  // Admin events
  | 'admin.user_view'
  | 'admin.data_export'
  | 'admin.data_delete'
  | 'admin.sso_config_update'
  // Security events
  | 'security.api_key_create'
  | 'security.api_key_revoke'
  | 'security.secret_rotation'
  | 'security.suspicious_activity';

export interface AuditLogEntry {
  userId: string | null;
  action: AuditAction;
  resourceType?: string; // 'project', 'user', 'org', 'deployment', etc.
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  organizationId?: string | null;
  severity?: 'info' | 'warning' | 'critical';
}

// ─── Audit Log Service ───────────────────────────────────────────────────────
class AuditLogService {
  private queue: AuditLogEntry[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private readonly BATCH_SIZE = 50;
  private readonly FLUSH_INTERVAL_MS = 5000; // 5 seconds

  constructor() {
    // Batch flush for performance
    this.flushInterval = setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);
  }

  /**
   * Record an audit event (non-blocking, batched)
   */
  log(entry: AuditLogEntry): void {
    this.queue.push({
      ...entry,
      severity: entry.severity || this.inferSeverity(entry.action),
    });

    // Flush immediately if batch is full
    if (this.queue.length >= this.BATCH_SIZE) {
      this.flush();
    }
  }

  /**
   * Record an audit event synchronously (for critical events)
   */
  async logSync(entry: AuditLogEntry): Promise<void> {
    try {
      const db = getDb();
      await db.execute(sql`
        INSERT INTO audit_logs (id, user_id, organization_id, action, resource_type, resource_id, metadata, ip_address, user_agent, severity, created_at)
        VALUES (
          gen_random_uuid(),
          ${entry.userId},
          ${entry.organizationId || null},
          ${entry.action},
          ${entry.resourceType || null},
          ${entry.resourceId || null},
          ${JSON.stringify(entry.metadata || {})}::jsonb,
          ${entry.ipAddress || null},
          ${entry.userAgent || null},
          ${entry.severity || this.inferSeverity(entry.action)},
          NOW()
        )
      `);
    } catch (err: any) {
      logger.error('[AuditLog] Failed to write sync audit log', {
        action: entry.action,
        error: err.message,
      });
    }
  }

  /**
   * Flush queued audit events to database
   */
  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.BATCH_SIZE);

    try {
      const db = getDb();

      // Build batch insert values
      const values = batch
        .map(
          (e) =>
            `(gen_random_uuid(), ${e.userId ? `'${e.userId}'` : 'NULL'}, ${e.organizationId ? `'${e.organizationId}'` : 'NULL'}, '${e.action}', ${e.resourceType ? `'${e.resourceType}'` : 'NULL'}, ${e.resourceId ? `'${e.resourceId}'` : 'NULL'}, '${JSON.stringify(e.metadata || {}).replace(/'/g, "''")}'::jsonb, ${e.ipAddress ? `'${e.ipAddress}'` : 'NULL'}, ${e.userAgent ? `'${e.userAgent.slice(0, 255).replace(/'/g, "''")}'` : 'NULL'}, '${e.severity || 'info'}', NOW())`,
        )
        .join(',\n');

      await db.execute(
        sql.raw(`
        INSERT INTO audit_logs (id, user_id, organization_id, action, resource_type, resource_id, metadata, ip_address, user_agent, severity, created_at)
        VALUES ${values}
      `),
      );
    } catch (err: any) {
      logger.error('[AuditLog] Failed to flush batch', {
        batchSize: batch.length,
        error: err.message,
      });
      // Re-queue failed entries (max 1 retry)
      if (batch.length < this.BATCH_SIZE * 2) {
        this.queue.unshift(...batch);
      }
    }
  }

  /**
   * Infer severity from action type
   */
  private inferSeverity(action: AuditAction): 'info' | 'warning' | 'critical' {
    if (
      action.startsWith('security.') ||
      action === 'auth.login_failed' ||
      action === 'admin.data_delete'
    ) {
      return 'critical';
    }
    if (
      action === 'auth.password_change' ||
      action === 'auth.mfa_disable' ||
      action === 'org.member_remove' ||
      action === 'deploy.rollback' ||
      action === 'project.delete'
    ) {
      return 'warning';
    }
    return 'info';
  }

  /**
   * Graceful shutdown — flush remaining events
   */
  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
  }

  /**
   * Get queue size (for monitoring)
   */
  getQueueSize(): number {
    return this.queue.length;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────
export const auditLog = new AuditLogService();

// ─── Helper: Extract audit context from Hono context ─────────────────────────
export function getAuditContext(c: any): {
  userId: string | null;
  ipAddress: string;
  userAgent: string;
  organizationId: string | null;
} {
  const session = c.get('session');
  return {
    userId: session?.userId || null,
    ipAddress:
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown',
    userAgent: c.req.header('user-agent') || 'unknown',
    organizationId: session?.organizationId || null,
  };
}
