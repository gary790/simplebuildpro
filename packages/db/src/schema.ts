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
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex('users_email_idx').on(table.email),
  orgIdx: index('users_org_idx').on(table.organizationId),
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
  type: varchar('type', { length: 32 }).notNull(), // 'ai_tokens' | 'deploy' | 'storage' | 'preview'
  quantity: bigint('quantity', { mode: 'number' }).notNull(),
  metadata: jsonb('metadata').default('{}'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userTypeIdx: index('usage_user_type_idx').on(table.userId, table.type),
  orgTypeIdx: index('usage_org_type_idx').on(table.organizationId, table.type),
  createdIdx: index('usage_created_idx').on(table.createdAt),
}));

// ─── Relations ───────────────────────────────────────────────
export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, { fields: [users.organizationId], references: [organizations.id] }),
  oauthAccounts: many(oauthAccounts),
  projects: many(projects),
  refreshTokens: many(refreshTokens),
}));

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(orgMembers),
  projects: many(projects),
  subscriptions: many(subscriptions),
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
}));

export const projectFilesRelations = relations(projectFiles, ({ one }) => ({
  project: one(projects, { fields: [projectFiles.projectId], references: [projects.id] }),
}));

export const projectAssetsRelations = relations(projectAssets, ({ one }) => ({
  project: one(projects, { fields: [projectAssets.projectId], references: [projects.id] }),
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
