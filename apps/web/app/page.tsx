// ============================================================
// SimpleBuild Pro — Landing Page
// Public homepage at simplebuildpro.com
// ============================================================

import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      {/* ─── Navbar ──────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-16">
          <Link href="/" className="text-xl font-extrabold text-slate-900 tracking-tight">
            SimpleBuild<span className="text-brand-600">Pro</span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">Features</a>
            <a href="#pricing" className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">Pricing</a>
            <a href="#faq" className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">FAQ</a>
            <Link href="/login" className="text-sm font-medium text-slate-700 hover:text-slate-900">Log in</Link>
            <Link href="/signup" className="px-4 py-2 bg-brand-600 text-white text-sm font-semibold rounded-lg hover:bg-brand-700 transition-all hover:-translate-y-0.5 shadow-sm hover:shadow-md">
              Start Free
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── Hero ────────────────────────────────────────────── */}
      <header className="relative overflow-hidden bg-gradient-to-b from-slate-50 to-white pt-24 pb-20">
        <div className="max-w-4xl mx-auto text-center px-6">
          <span className="inline-block px-3 py-1 bg-brand-50 text-brand-700 text-xs font-semibold rounded-full mb-6 border border-brand-100">
            Enterprise Website Builder
          </span>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-slate-900 leading-[1.08] mb-6">
            Build websites<br />
            <span className="bg-gradient-to-r from-brand-600 to-blue-500 bg-clip-text text-transparent">at enterprise scale</span>
          </h1>
          <p className="text-xl text-slate-500 max-w-2xl mx-auto mb-10 leading-relaxed">
            Code editor, AI assistant, live preview, one-click deploy.
            Everything you need to ship production websites — fast.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link href="/signup" className="px-8 py-3.5 bg-brand-600 text-white font-semibold rounded-xl text-base hover:bg-brand-700 transition-all hover:-translate-y-0.5 shadow-lg shadow-brand-600/20 hover:shadow-brand-600/30">
              Start Building Free →
            </Link>
            <a href="#features" className="px-8 py-3.5 bg-slate-100 text-slate-700 font-semibold rounded-xl text-base hover:bg-slate-200 transition-all border border-slate-200">
              See Features
            </a>
          </div>
        </div>

        {/* Decorative gradient orbs */}
        <div className="absolute top-20 left-1/4 w-72 h-72 bg-brand-200/30 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 right-1/4 w-60 h-60 bg-blue-200/20 rounded-full blur-3xl pointer-events-none" />
      </header>

      {/* ─── Features ────────────────────────────────────────── */}
      <section id="features" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight mb-4">
              Everything you need to build
            </h2>
            <p className="text-lg text-slate-500 max-w-xl mx-auto">
              A complete platform for building, previewing, and deploying websites.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { icon: '⚡', title: 'Monaco Code Editor', desc: 'Full VS Code editor experience in the browser with syntax highlighting, IntelliSense, and multi-file support.' },
              { icon: '🤖', title: 'AI Assistant', desc: 'Claude-powered AI that sees your entire project, generates code, and applies changes directly to your files.' },
              { icon: '👁️', title: 'Live Preview', desc: 'Real-time isolated preview via Novita sandbox. See your changes instantly in a production-like environment.' },
              { icon: '🚀', title: 'One-Click Deploy', desc: 'Deploy to a global CDN with a single click. Custom domains, auto-SSL, and instant rollbacks included.' },
              { icon: '📦', title: 'Asset Management', desc: 'Upload images, fonts, and files. Automatic optimization with global CDN delivery for blazing-fast load times.' },
              { icon: '🔒', title: 'Enterprise Security', desc: 'JWT auth, encrypted storage, rate limiting, input sanitization, and full audit logging out of the box.' },
              { icon: '📊', title: 'Version History', desc: 'Full project snapshots with every build. Restore any version with one click — nothing is ever lost.' },
              { icon: '💳', title: 'Stripe Billing', desc: 'Subscription management with Stripe. Free, Pro, Business, and Enterprise tiers with usage metering.' },
              { icon: '☁️', title: 'Google Cloud', desc: 'Hosted on Cloud Run with Cloud SQL, Cloud Storage, and Cloud CDN for maximum speed and reliability.' },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="group p-6 rounded-2xl border border-slate-200 hover:border-brand-200 hover:shadow-lg hover:-translate-y-1 transition-all duration-200 bg-white">
                <span className="text-2xl mb-3 block">{icon}</span>
                <h3 className="text-base font-bold text-slate-900 mb-2">{title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How It Works ────────────────────────────────────── */}
      <section className="py-24 bg-slate-50">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight mb-4">
              How it works
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-12">
            {[
              { step: '01', title: 'Create a project', desc: 'Start from a template or a blank canvas. Name your project and begin coding instantly.' },
              { step: '02', title: 'Build with AI', desc: 'Use the AI assistant to generate code, fix bugs, or redesign entire sections — all within context of your project.' },
              { step: '03', title: 'Deploy globally', desc: 'Build, preview in an isolated sandbox, then deploy to a global CDN with custom domain and SSL.' },
            ].map(({ step, title, desc }) => (
              <div key={step} className="text-center">
                <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-600 text-white text-lg font-bold rounded-2xl mb-5">
                  {step}
                </div>
                <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─────────────────────────────────────────── */}
      <section id="pricing" className="py-24 bg-white">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight mb-4">
              Simple, transparent pricing
            </h2>
            <p className="text-lg text-slate-500">Start free. Upgrade when you&apos;re ready.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Free */}
            <div className="p-8 rounded-2xl border border-slate-200 bg-white">
              <h3 className="text-lg font-bold text-slate-900 mb-2">Free</h3>
              <div className="mb-6">
                <span className="text-4xl font-extrabold text-slate-900">$0</span>
                <span className="text-slate-500 text-sm">/month</span>
              </div>
              <ul className="space-y-3 mb-8 text-sm text-slate-600">
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 3 projects</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 50 AI messages / month</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 100 MB storage</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> Live preview</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 10 deploys / month</li>
              </ul>
              <Link href="/signup" className="block text-center px-6 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors">
                Get Started
              </Link>
            </div>

            {/* Pro */}
            <div className="relative p-8 rounded-2xl border-2 border-brand-600 bg-white shadow-lg shadow-brand-600/5">
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-brand-600 text-white text-xs font-bold rounded-full">
                Most Popular
              </span>
              <h3 className="text-lg font-bold text-slate-900 mb-2">Pro</h3>
              <div className="mb-6">
                <span className="text-4xl font-extrabold text-slate-900">$19</span>
                <span className="text-slate-500 text-sm">/month</span>
              </div>
              <ul className="space-y-3 mb-8 text-sm text-slate-600">
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 25 projects</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 500 AI messages / month</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 5 GB storage</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 3 custom domains</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> Unlimited deploys</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> Priority support</li>
              </ul>
              <Link href="/signup?plan=pro" className="block text-center px-6 py-2.5 rounded-lg bg-brand-600 text-white font-semibold text-sm hover:bg-brand-700 transition-all shadow-sm">
                Start Free Trial
              </Link>
            </div>

            {/* Business */}
            <div className="p-8 rounded-2xl border border-slate-200 bg-white">
              <h3 className="text-lg font-bold text-slate-900 mb-2">Business</h3>
              <div className="mb-6">
                <span className="text-4xl font-extrabold text-slate-900">$49</span>
                <span className="text-slate-500 text-sm">/month</span>
              </div>
              <ul className="space-y-3 mb-8 text-sm text-slate-600">
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> Unlimited projects</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 2,000 AI messages / month</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 25 GB storage</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> 10 custom domains</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> Team collaboration</li>
                <li className="flex items-center gap-2"><span className="text-green-500">✓</span> Dedicated support</li>
              </ul>
              <Link href="/signup?plan=business" className="block text-center px-6 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors">
                Contact Sales
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA ─────────────────────────────────────────────── */}
      <section className="py-24 bg-slate-900 text-white">
        <div className="max-w-3xl mx-auto text-center px-6">
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight mb-4">
            Ready to build?
          </h2>
          <p className="text-lg text-slate-400 mb-10">
            Join developers and teams shipping production websites with SimpleBuild Pro.
          </p>
          <Link href="/signup" className="inline-block px-10 py-4 bg-brand-600 text-white font-semibold rounded-xl text-lg hover:bg-brand-500 transition-all hover:-translate-y-0.5 shadow-lg shadow-brand-600/30">
            Start Building Free →
          </Link>
        </div>
      </section>

      {/* ─── Footer ──────────────────────────────────────────── */}
      <footer className="py-12 bg-white border-t border-slate-200">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <span className="text-sm font-bold text-slate-900">
              SimpleBuild<span className="text-brand-600">Pro</span>
            </span>
            <div className="flex items-center gap-6">
              <a href="#" className="text-sm text-slate-500 hover:text-slate-700">Privacy</a>
              <a href="#" className="text-sm text-slate-500 hover:text-slate-700">Terms</a>
              <a href="#" className="text-sm text-slate-500 hover:text-slate-700">Contact</a>
            </div>
            <p className="text-sm text-slate-400">&copy; 2026 SimpleBuild Pro. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
