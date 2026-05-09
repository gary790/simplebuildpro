-- ============================================================
-- SimpleBuild Pro — Seed Data for Local Development
-- Run: psql $DATABASE_URL -f seed.sql
-- Or:  docker exec -i simplebuildpro-db psql -U simplebuild -d simplebuildpro < seed.sql
-- ============================================================

-- Password hash for "password123" (bcrypt, 10 rounds)
-- Use this for all test accounts in local dev
-- $2a$10$rQEY4z9K4Fk0K4Fk0K4Fk.EXAMPLE — replace with actual hash at runtime

-- ─── Test Users ──────────────────────────────────────────────
-- Note: password_hash below is bcrypt hash of "Password123!"
-- Generated via: require('bcryptjs').hashSync('Password123!', 10)
INSERT INTO users (id, email, name, password_hash, plan, email_verified, billing_status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'admin@simplebuildpro.com', 'Admin User',
   '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'enterprise', true, 'active'),
  ('22222222-2222-2222-2222-222222222222', 'pro@simplebuildpro.com', 'Pro User',
   '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'pro', true, 'active'),
  ('33333333-3333-3333-3333-333333333333', 'free@simplebuildpro.com', 'Free User',
   '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'free', true, 'free'),
  ('44444444-4444-4444-4444-444444444444', 'team@simplebuildpro.com', 'Team Member',
   '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'business', true, 'active')
ON CONFLICT (id) DO NOTHING;

-- ─── Organization ────────────────────────────────────────────
INSERT INTO organizations (id, name, slug, owner_id)
VALUES
  ('aaaa1111-1111-1111-1111-111111111111', 'SimpleBuild Team', 'simplebuild-team',
   '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

-- ─── Organization Members ────────────────────────────────────
INSERT INTO org_members (organization_id, user_id, role)
VALUES
  ('aaaa1111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaa1111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'editor')
ON CONFLICT DO NOTHING;

-- ─── Update users with org reference ─────────────────────────
UPDATE users SET organization_id = 'aaaa1111-1111-1111-1111-111111111111'
WHERE id IN ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444');

-- ─── Projects ────────────────────────────────────────────────
INSERT INTO projects (id, owner_id, name, slug, description, status)
VALUES
  ('bbbb1111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'Landing Page', 'landing-page', 'Company landing page with hero, features, and CTA', 'published'),
  ('bbbb2222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
   'Portfolio Site', 'portfolio-site', 'Personal portfolio with project showcase', 'draft'),
  ('bbbb3333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333',
   'Blog Starter', 'blog-starter', 'Simple blog with Tailwind CSS', 'draft'),
  ('bbbb4444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
   'Dashboard App', 'dashboard-app', 'Admin dashboard with charts and data tables', 'draft')
ON CONFLICT (id) DO NOTHING;

-- ─── Project Files (Landing Page) ────────────────────────────
INSERT INTO project_files (project_id, path, content, content_hash, mime_type, size_bytes)
VALUES
  ('bbbb1111-1111-1111-1111-111111111111', 'index.html',
   '<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to SimpleBuild</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-white text-gray-900">
  <header class="bg-indigo-600 text-white py-20 text-center">
    <h1 class="text-5xl font-bold">Build Faster</h1>
    <p class="mt-4 text-xl opacity-90">AI-powered website builder</p>
    <button class="mt-8 bg-white text-indigo-600 px-8 py-3 rounded-lg font-semibold hover:bg-gray-100">
      Get Started
    </button>
  </header>
  <main class="max-w-4xl mx-auto py-16 px-4">
    <h2 class="text-3xl font-bold text-center mb-12">Features</h2>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
      <div class="text-center p-6">
        <div class="text-4xl mb-4">⚡</div>
        <h3 class="font-semibold text-lg">Lightning Fast</h3>
        <p class="text-gray-600 mt-2">Build websites in minutes, not hours</p>
      </div>
      <div class="text-center p-6">
        <div class="text-4xl mb-4">🤖</div>
        <h3 class="font-semibold text-lg">AI Powered</h3>
        <p class="text-gray-600 mt-2">Let AI write your code</p>
      </div>
      <div class="text-center p-6">
        <div class="text-4xl mb-4">🚀</div>
        <h3 class="font-semibold text-lg">One-Click Deploy</h3>
        <p class="text-gray-600 mt-2">Ship to production instantly</p>
      </div>
    </div>
  </main>
</body>
</html>',
   'seed-hash-index', 'text/html', 1200),

  ('bbbb1111-1111-1111-1111-111111111111', 'styles.css',
   'body { font-family: system-ui, sans-serif; }
.hero { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }',
   'seed-hash-styles', 'text/css', 120)
ON CONFLICT DO NOTHING;

-- ─── Project Files (Portfolio) ───────────────────────────────
INSERT INTO project_files (project_id, path, content, content_hash, mime_type, size_bytes)
VALUES
  ('bbbb2222-2222-2222-2222-222222222222', 'index.html',
   '<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Portfolio</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50">
  <nav class="bg-white shadow-sm py-4 px-8">
    <h1 class="text-xl font-bold">My Portfolio</h1>
  </nav>
  <main class="max-w-6xl mx-auto py-12 px-4">
    <section class="text-center mb-16">
      <h2 class="text-4xl font-bold">Hello, I am a Developer</h2>
      <p class="text-gray-600 mt-4 text-lg">Building beautiful things for the web</p>
    </section>
  </main>
</body>
</html>',
   'seed-hash-portfolio', 'text/html', 600)
ON CONFLICT DO NOTHING;

-- ─── AI Conversations (sample) ───────────────────────────────
INSERT INTO ai_conversations (id, project_id, user_id, message_count, total_tokens_used)
VALUES
  ('cccc1111-1111-1111-1111-111111111111', 'bbbb1111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111', 2, 1500)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_messages (conversation_id, role, content, tokens_used)
VALUES
  ('cccc1111-1111-1111-1111-111111111111', 'user',
   'Build me a landing page with a hero section, features grid, and a call-to-action button', 0),
  ('cccc1111-1111-1111-1111-111111111111', 'assistant',
   '[Generated 2 file(s): index.html, styles.css]', 1500)
ON CONFLICT DO NOTHING;

-- ─── Summary ─────────────────────────────────────────────────
-- Test accounts (all use password: Password123!)
--   admin@simplebuildpro.com  — Enterprise plan, org owner
--   pro@simplebuildpro.com    — Pro plan
--   free@simplebuildpro.com   — Free plan
--   team@simplebuildpro.com   — Business plan, org member
--
-- Projects:
--   Landing Page (published, has files + AI conversation)
--   Portfolio Site (draft, has files)
--   Blog Starter (draft, empty)
--   Dashboard App (draft, empty)
