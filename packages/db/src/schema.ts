// ============================================================
// SimpleBuild Pro — Database Schema
// Cloud SQL PostgreSQL via Drizzle ORM
// Production schema — all tables, indexes, relations
// ============================================================

import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  integer,
  bigint,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── Enums ───────────────────────────────────────────────────
export const userPlanEnum = pgEnum('user_plan', ['free', 'pro', 'business', 'enterprise']);
export const orgRoleEnum = pgEnum('org_role', ['owner', 'admin', 'editor', 'viewer']);
export const projectStatusEnum = pgEnum('project_status', ['draft', 'published', 'archived']);
export const deploymentStatusEnum = pgEnum('deployment_status', [
  'queued', 'building', 'deploying', 'live', 'failed', 'rolled_back',
]);
export const sslStatusEnum = pgEnum('ssl_status', ['pending', 'active', 'expired', 'error']);
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'active', 'past_due', 'canceled', 'trialing',
]);
export const previewStatusEnum = pgEnum('preview_status', [
  'creating', 'running', 'paused', 'stopped', 'error',
]);

// ─── Users ───────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  avatarUrl: text('avatar_url'),
  plan: userPlanEnum('plan').notNull().default('free'),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  emailVerified: boolean('email_verified').notNull().default(false),
  // Billing fields (PAYG)
  stripeCustomerId: varchar('stripe_customer_id', { length: 128 }),
  billingStatus: varchar('billing_status', { length: 32 }).notNull().default('free'),
  dailySpendLimitCents: integer('daily_spend_limit_cents').default(5000),
  paymentMethodAdded: boolean('payment_method_added').notNull().default(false),
  creditBalanceCents: integer('credit_balance_cents').notNull().default(0),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex('users_email_idx').on(table.email),
  orgIdx: index('users_org_idx').on(table.organizationId),
  stripeIdx: index('users_stripe_idx').on(table.stripeCustomerId),
  billingStatusIdx: index('users_billing_status_idx').on(table.billingStatus),
}));

// ─── OAuth Accounts ──────────────────────────────────────────
export const oauthAccounts = pgTable('oauth_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 32 }).notNull(), // 'google' | 'github'
  providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  providerIdx: uniqueIndex('oauth_provider_idx').on(table.provider, table.providerAccountId),
  userIdx: index('oauth_user_idx').on(table.userId),
}));

// ─── Refresh Tokens ──────────────────────────────────────────
export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index('refresh_tokens_user_idx').on(table.userId),
  tokenIdx: uniqueIndex('refresh_tokens_hash_idx').on(table.tokenHash),
}));

// ─── Organizations ───────────────────────────────────────────
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 48 }).notNull(),
  ownerId: uuid('owner_id').notNull(),
  plan: userPlanEnum('plan').notNull().default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  slugIdx: uniqueIndex('orgs_slug_idx').on(table.slug),
  ownerIdx: index('orgs_owner_idx').on(table.ownerId),
}));

// ─── Organization Members ────────────────────────────────────
export const orgMembers = pgTable('org_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: orgRoleEnum('role').notNull().default('viewer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orgUserIdx: uniqueIndex('org_members_org_user_idx').on(table.organizationId, table.userId),
  userIdx: index('org_members_user_idx').on(table.userId),
}));

// ─── Projects ────────────────────────────────────────────────
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 64 }).notNull(),
  slug: varchar('slug', { length: 64 }).notNull(),
  description: text('description'),
  templateId: varchar('template_id', { length: 64 }),
  settings: jsonb('settings').notNull().default('{}'),
  status: projectStatusEnum('status').notNull().default('draft'),
  lastDeployedAt: timestamp('last_deployed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerIdx: index('projects_owner_idx').on(table.ownerId),
  orgIdx: index('projects_org_idx').on(table.organizationId),
  slugIdx: uniqueIndex('projects_owner_slug_idx').on(table.ownerId, table.slug),
  statusIdx: index('projects_status_idx').on(table.status),
}));

// ─── Project Files ───────────────────────────────────────────
export const projectFiles = pgTable('project_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  path: varchar('path', { length: 512 }).notNull(),
  content: text('content').notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  mimeType: varchar('mime_type', { length: 128 }).notNull().default('text/plain'),
  sizeBytes: integer('size_bytes').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  projectPathIdx: uniqueIndex('files_project_path_idx').on(table.projectId, table.path),
  projectIdx: index('files_project_idx').on(table.projectId),
}));

// ─── Project Assets ──────────────────────────────────────────
export const projectAssets = pgTable('project_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  filename: varchar('filename', { length: 255 }).notNull(),
  originalFilename: varchar('original_filename', { length: 255 }).notNull(),
  gcsKey: text('gcs_key').notNull(),
  cdnUrl: text('cdn_url').notNull(),
  mimeType: varchar('mime_type', { length: 128 }).notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  width: integer('width'),
  height: integer('height'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  projectIdx: index('assets_project_idx').on(table.projectId),
}));

// ─── Project Versions (Snapshots) ────────────────────────────
export const projectVersions = pgTable('project_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  snapshotGcsKey: text('snapshot_gcs_key').notNull(),
  message: varchar('message', { length: 255 }).notNull().default(''),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  fileCount: integer('file_count').notNull().default(0),
  totalSizeBytes: bigint('total_size_bytes', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  projectVersionIdx: uniqueIndex('versions_project_version_idx').on(table.projectId, table.versionNumber),
  projectIdx: index('versions_project_idx').on(table.projectId),
}));

// ─── Deployments ─────────────────────────────────────────────
export const deployments = pgTable('deployments', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  versionId: uuid('version_id').notNull().references(() => projectVersions.id),
  status: deploymentStatusEnum('status').notNull().default('queued'),
  url: text('url').notNull(),
  cdnUrl: text('cdn_url'),
  customDomain: varchar('custom_domain', { length: 253 }),
  gcsPrefix: text('gcs_prefix').notNull(),
  buildDurationMs: integer('build_duration_ms'),
  lighthouseScore: integer('lighthouse_score'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  projectIdx: index('deployments_project_idx').on(table.projectId),
  statusIdx: index('deployments_status_idx').on(table.status),
}));

// ─── Custom Domains ──────────────────────────────────────────
export const customDomains = pgTable('custom_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  domain: varchar('domain', { length: 253 }).notNull(),
  sslStatus: sslStatusEnum('ssl_status').notNull().default('pending'),
  dnsVerified: boolean('dns_verified').notNull().default(false),
  dnsRecords: jsonb('dns_records').notNull().default('[]'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  domainIdx: uniqueIndex('domains_domain_idx').on(table.domain),
  projectIdx: index('domains_project_idx').on(table.projectId),
}));

// ─── AI Conversations ────────────────────────────────────────
export const aiConversations = pgTable('ai_conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  messageCount: integer('message_count').notNull().default(0),
  totalTokensUsed: integer('total_tokens_used').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  projectIdx: index('conversations_project_idx').on(table.projectId),
  userIdx: index('conversations_user_idx').on(table.userId),
}));

// ─── AI Messages ─────────────────────────────────────────────
export const aiMessages = pgTable('ai_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 16 }).notNull(), // 'user' | 'assistant' | 'system'
  content: text('content').notNull(),
  attachments: jsonb('attachments').notNull().default('[]'),
  tokensUsed: integer('tokens_used').notNull().default(0),
  appliedFiles: boolean('applied_files').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  conversationIdx: index('messages_conversation_idx').on(table.conversationId),
}));

// ─── Preview Sessions (Novita Sandbox) ───────────────────────
export const previewSessions = pgTable('preview_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  novitaSandboxId: varchar('novita_sandbox_id', { length: 128 }).notNull(),
  previewUrl: text('preview_url').notNull(),
  status: previewStatusEnum('status').notNull().default('creating'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  projectIdx: index('preview_project_idx').on(table.projectId),
  sandboxIdx: uniqueIndex('preview_sandbox_idx').on(table.novitaSandboxId),
}));

// ─── Subscriptions ───────────────────────────────────────────
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  stripeCustomerId: varchar('stripe_customer_id', { length: 128 }).notNull(),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 128 }).notNull(),
  plan: userPlanEnum('plan').notNull(),
  status: subscriptionStatusEnum('status').notNull().default('active'),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  stripeSubIdx: uniqueIndex('subs_stripe_sub_idx').on(table.stripeSubscriptionId),
  userIdx: index('subs_user_idx').on(table.userId),
  orgIdx: index('subs_org_idx').on(table.organizationId),
}));

// ─── Usage Logs ──────────────────────────────────────────────
export const usageLogs = pgTable('usage_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 32 }).notNull(), // 'ai_input_tokens' | 'ai_output_tokens' | 'deploy' | 'storage' | 'preview' | 'bandwidth'
  quantity: bigint('quantity', { mode: 'number' }).notNull(),
  costCents: text('cost_cents').default('0'),       // Our actual cost
  priceCents: text('price_cents').default('0'),     // What customer pays (cost * 1.5)
  billed: boolean('billed').notNull().default(false),
  billingPeriod: text('billing_period'),            // YYYY-MM-DD date string
  metadata: jsonb('metadata').default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userTypeIdx: index('usage_user_type_idx').on(table.userId, table.type),
  orgTypeIdx: index('usage_org_type_idx').on(table.organizationId, table.type),
  createdIdx: index('usage_created_idx').on(table.createdAt),
  billedIdx: index('usage_billed_idx').on(table.billed, table.billingPeriod),
  userPeriodIdx: index('usage_user_period_idx').on(table.userId, table.billingPeriod),
}));

// ─── Daily Usage Summary ─────────────────────────────────────
export const dailyUsageSummary = pgTable('daily_usage_summary', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),                     // YYYY-MM-DD
  aiInputTokens: bigint('ai_input_tokens', { mode: 'number' }).notNull().default(0),
  aiOutputTokens: bigint('ai_output_tokens', { mode: 'number' }).notNull().default(0),
  aiMessages: integer('ai_messages').notNull().default(0),
  deploys: integer('deploys').notNull().default(0),
  storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
  previewSeconds: integer('preview_seconds').notNull().default(0),
  bandwidthBytes: bigint('bandwidth_bytes', { mode: 'number' }).notNull().default(0),
  totalCostCents: text('total_cost_cents').notNull().default('0'),
  totalPriceCents: text('total_price_cents').notNull().default('0'),
  stripeReported: boolean('stripe_reported').notNull().default(false),
  stripeInvoiceItemId: varchar('stripe_invoice_item_id', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userDateIdx: uniqueIndex('daily_usage_user_date_idx').on(table.userId, table.date),
  unreportedIdx: index('daily_usage_unreported_idx').on(table.stripeReported, table.date),
}));

// ─── Billing Events ──────────────────────────────────────────
export const billingEvents = pgTable('billing_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 64 }).notNull(),
  amountCents: integer('amount_cents'),
  stripeEventId: varchar('stripe_event_id', { length: 128 }),
  metadata: jsonb('metadata').default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index('billing_events_user_idx').on(table.userId),
  typeIdx: index('billing_events_type_idx').on(table.type),
}));

// ─── Email Verification Tokens ───────────────────────────────
export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 128 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tokenIdx: index('evt_token_idx').on(table.token),
  userIdx: index('evt_user_idx').on(table.userId),
}));

// ─── Password Reset Tokens ───────────────────────────────────
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar('token', { length: 128 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tokenIdx: index('prt_token_idx').on(table.token),
  userIdx: index('prt_user_idx').on(table.userId),
}));

// ─── User Connections (Integrations) ────────────────────────
export const userConnections = pgTable('user_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 32 }).notNull(), // 'github_repo', 'cloudflare', 'vercel', 'netlify', 'supabase'
  displayName: varchar('display_name', { length: 255 }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  accountId: varchar('account_id', { length: 255 }),
  metadata: jsonb('metadata').notNull().default('{}'),
  connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index('user_connections_user_idx').on(table.userId),
  providerIdx: uniqueIndex('user_connections_provider_unique').on(table.userId, table.provider),
}));

// ─── Project Integrations ───────────────────────────────────
export const projectIntegrations = pgTable('project_integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 32 }).notNull(),
  connectionId: uuid('connection_id').references(() => userConnections.id, { onDelete: 'set null' }),
  config: jsonb('config').notNull().default('{}'),
  lastActionAt: timestamp('last_action_at', { withTimezone: true }),
  lastActionResult: jsonb('last_action_result'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  projectIdx: index('project_integrations_project_idx').on(table.projectId),
  providerIdx: uniqueIndex('project_integrations_provider_unique').on(table.projectId, table.provider),
  connectionIdx: index('project_integrations_connection_idx').on(table.connectionId),
}));

// ─── Project Environment Variables ──────────────────────────
export const projectEnvVars = pgTable('project_env_vars', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  key: varchar('key', { length: 128 }).notNull(),
  value: text('value').notNull(),
  isSecret: boolean('is_secret').notNull().default(true),
  description: varchar('description', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  projectIdx: index('project_env_vars_project_idx').on(table.projectId),
  uniqueKeyIdx: uniqueIndex('project_env_vars_unique').on(table.projectId, table.key),
}));

// ─── Relations ───────────────────────────────────────────────
export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, { fields: [users.organizationId], references: [organizations.id] }),
  oauthAccounts: many(oauthAccounts),
  connections: many(userConnections),
  projects: many(projects),
  refreshTokens: many(refreshTokens),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(orgMembers),
  projects: many(projects),
  subscriptions: many(subscriptions),
}));

export const userConnectionsRelations = relations(userConnections, ({ one }) => ({
  user: one(users, { fields: [userConnections.userId], references: [users.id] }),
}));

export const projectIntegrationsRelations = relations(projectIntegrations, ({ one }) => ({
  project: one(projects, { fields: [projectIntegrations.projectId], references: [projects.id] }),
  connection: one(userConnections, { fields: [projectIntegrations.connectionId], references: [userConnections.id] }),
}));

export const projectEnvVarsRelations = relations(projectEnvVars, ({ one }) => ({
  project: one(projects, { fields: [projectEnvVars.projectId], references: [projects.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  organization: one(organizations, { fields: [projects.organizationId], references: [organizations.id] }),
  files: many(projectFiles),
  assets: many(projectAssets),
  versions: many(projectVersions),
  deployments: many(deployments),
  conversations: many(aiConversations),
  customDomains: many(customDomains),
  previewSessions: many(previewSessions),
  integrations: many(projectIntegrations),
  envVars: many(projectEnvVars),
}));

export const projectFilesRelations = relations(projectFiles, ({ one }) => ({
  project: one(projects, { fields: [projectFiles.projectId], references: [projects.id] }),
}));

export const projectAssetsRelations = relations(projectAssets, ({ one }) => ({
  project: one(projects, { fields: [projectAssets.projectId], references: [projects.id] }),
}));

export const projectVersionsRelations = relations(projectVersions, ({ one }) => ({
  project: one(projects, { fields: [projectVersions.projectId], references: [projects.id] }),
}));

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  project: one(projects, { fields: [deployments.projectId], references: [projects.id] }),
  version: one(projectVersions, { fields: [deployments.versionId], references: [projectVersions.id] }),
  createdByUser: one(users, { fields: [deployments.createdBy], references: [users.id] }),
}));

export const aiConversationsRelations = relations(aiConversations, ({ one, many }) => ({
  project: one(projects, { fields: [aiConversations.projectId], references: [projects.id] }),
  user: one(users, { fields: [aiConversations.userId], references: [users.id] }),
  messages: many(aiMessages),
}));

export const aiMessagesRelations = relations(aiMessages, ({ one }) => ({
  conversation: one(aiConversations, { fields: [aiMessages.conversationId], references: [aiConversations.id] }),
}));
