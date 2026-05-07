// ============================================================
// SimpleBuild Pro — Starter Templates
// Real production templates with proper HTML5 structure
// ============================================================

export interface StarterTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: TemplateCategory;
  files: Record<string, string>;
  thumbnail: string | null;
}

export type TemplateCategory = 'blank' | 'landing' | 'portfolio' | 'blog' | 'business' | 'ecommerce';

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'blank',
    name: 'Blank Project',
    description: 'Start from scratch with a clean HTML5 boilerplate.',
    icon: '📄',
    category: 'blank',
    thumbnail: null,
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="">
  <title>My Website</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Hello World</h1>
    <p>Start building your website.</p>
  </main>
  <script src="app.js"></script>
</body>
</html>`,
      'style.css': `/* Reset & Base */
*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --color-primary: #2563eb;
  --color-text: #1a1a2e;
  --color-bg: #ffffff;
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
}

body {
  font-family: var(--font-sans);
  color: var(--color-text);
  background: var(--color-bg);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 4rem 2rem;
}

h1 {
  font-size: 3rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 1rem;
}

p {
  font-size: 1.125rem;
  color: #64748b;
}`,
      'app.js': `// SimpleBuild Pro — App
document.addEventListener('DOMContentLoaded', () => {
  console.log('Site loaded successfully.');
});`,
    },
  },
  {
    id: 'landing-page',
    name: 'Landing Page',
    description: 'Modern landing page with hero, features, and CTA sections.',
    icon: '🚀',
    category: 'landing',
    thumbnail: null,
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Build something amazing with our platform.">
  <title>Landing Page</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <nav class="navbar">
    <div class="nav-container">
      <a href="/" class="nav-logo">Brand</a>
      <div class="nav-links">
        <a href="#features">Features</a>
        <a href="#pricing">Pricing</a>
        <a href="#contact">Contact</a>
        <a href="#" class="btn btn-primary btn-sm">Get Started</a>
      </div>
    </div>
  </nav>

  <header class="hero">
    <div class="hero-content">
      <span class="hero-badge">Now in Beta</span>
      <h1>Build Something<br>Amazing Today</h1>
      <p>The fastest way to ship your next project. No complexity, just results.</p>
      <div class="hero-actions">
        <a href="#" class="btn btn-primary btn-lg">Start Free Trial</a>
        <a href="#features" class="btn btn-secondary btn-lg">Learn More</a>
      </div>
    </div>
  </header>

  <section id="features" class="features">
    <div class="container">
      <h2 class="section-title">Everything you need</h2>
      <p class="section-subtitle">Powerful features to help you build faster.</p>
      <div class="features-grid">
        <div class="feature-card">
          <div class="feature-icon">⚡</div>
          <h3>Lightning Fast</h3>
          <p>Optimized for speed with global CDN delivery.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">🔒</div>
          <h3>Secure by Default</h3>
          <p>Enterprise-grade security built into every layer.</p>
        </div>
        <div class="feature-card">
          <div class="feature-icon">📱</div>
          <h3>Fully Responsive</h3>
          <p>Looks perfect on every device, every time.</p>
        </div>
      </div>
    </div>
  </section>

  <section id="pricing" class="pricing">
    <div class="container">
      <h2 class="section-title">Simple pricing</h2>
      <p class="section-subtitle">Start free. Upgrade when you're ready.</p>
      <div class="pricing-grid">
        <div class="pricing-card">
          <h3>Free</h3>
          <div class="price">$0<span>/month</span></div>
          <ul>
            <li>3 projects</li>
            <li>100 MB storage</li>
            <li>Community support</li>
          </ul>
          <a href="#" class="btn btn-secondary">Get Started</a>
        </div>
        <div class="pricing-card pricing-featured">
          <div class="pricing-badge">Popular</div>
          <h3>Pro</h3>
          <div class="price">$19<span>/month</span></div>
          <ul>
            <li>25 projects</li>
            <li>5 GB storage</li>
            <li>Custom domains</li>
            <li>Priority support</li>
          </ul>
          <a href="#" class="btn btn-primary">Start Free Trial</a>
        </div>
        <div class="pricing-card">
          <h3>Business</h3>
          <div class="price">$49<span>/month</span></div>
          <ul>
            <li>Unlimited projects</li>
            <li>25 GB storage</li>
            <li>Team collaboration</li>
            <li>Dedicated support</li>
          </ul>
          <a href="#" class="btn btn-secondary">Contact Sales</a>
        </div>
      </div>
    </div>
  </section>

  <footer class="footer">
    <div class="container">
      <p>&copy; 2026 Brand. All rights reserved.</p>
    </div>
  </footer>

  <script src="app.js"></script>
</body>
</html>`,
      'style.css': `*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --primary: #2563eb;
  --primary-dark: #1d4ed8;
  --text: #0f172a;
  --text-light: #64748b;
  --bg: #ffffff;
  --bg-subtle: #f8fafc;
  --border: #e2e8f0;
  --radius: 12px;
  --shadow: 0 1px 3px rgba(0,0,0,0.08);
  --shadow-lg: 0 10px 40px rgba(0,0,0,0.08);
  --font: 'Inter', system-ui, -apple-system, sans-serif;
}

body { font-family: var(--font); color: var(--text); background: var(--bg); line-height: 1.6; -webkit-font-smoothing: antialiased; }
.container { max-width: 1200px; margin: 0 auto; padding: 0 2rem; }

/* Navbar */
.navbar { position: sticky; top: 0; background: rgba(255,255,255,0.9); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); z-index: 100; }
.nav-container { max-width: 1200px; margin: 0 auto; padding: 0 2rem; display: flex; align-items: center; justify-content: space-between; height: 64px; }
.nav-logo { font-weight: 800; font-size: 1.25rem; color: var(--text); text-decoration: none; }
.nav-links { display: flex; align-items: center; gap: 2rem; }
.nav-links a { text-decoration: none; color: var(--text-light); font-size: 0.9rem; font-weight: 500; transition: color 0.2s; }
.nav-links a:hover { color: var(--text); }

/* Buttons */
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.625rem 1.5rem; border-radius: 8px; font-weight: 600; font-size: 0.9rem; text-decoration: none; transition: all 0.2s; border: none; cursor: pointer; }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover { background: var(--primary-dark); transform: translateY(-1px); box-shadow: var(--shadow-lg); }
.btn-secondary { background: var(--bg-subtle); color: var(--text); border: 1px solid var(--border); }
.btn-secondary:hover { background: #fff; border-color: var(--text-light); }
.btn-sm { padding: 0.4rem 1rem; font-size: 0.8rem; }
.btn-lg { padding: 0.875rem 2rem; font-size: 1rem; }

/* Hero */
.hero { padding: 8rem 2rem 6rem; text-align: center; background: linear-gradient(180deg, var(--bg-subtle) 0%, var(--bg) 100%); }
.hero-content { max-width: 720px; margin: 0 auto; }
.hero-badge { display: inline-block; padding: 0.25rem 0.875rem; background: #dbeafe; color: var(--primary); border-radius: 20px; font-size: 0.8rem; font-weight: 600; margin-bottom: 1.5rem; }
.hero h1 { font-size: clamp(2.5rem, 6vw, 4rem); font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 1.5rem; }
.hero p { font-size: 1.2rem; color: var(--text-light); max-width: 540px; margin: 0 auto 2rem; }
.hero-actions { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }

/* Sections */
.section-title { font-size: 2.25rem; font-weight: 800; text-align: center; letter-spacing: -0.02em; margin-bottom: 0.5rem; }
.section-subtitle { text-align: center; color: var(--text-light); font-size: 1.1rem; margin-bottom: 3rem; }

/* Features */
.features { padding: 6rem 0; }
.features-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 2rem; }
.feature-card { padding: 2rem; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg); transition: all 0.2s; }
.feature-card:hover { box-shadow: var(--shadow-lg); transform: translateY(-2px); }
.feature-icon { font-size: 2rem; margin-bottom: 1rem; }
.feature-card h3 { font-size: 1.15rem; font-weight: 700; margin-bottom: 0.5rem; }
.feature-card p { color: var(--text-light); font-size: 0.9rem; }

/* Pricing */
.pricing { padding: 6rem 0; background: var(--bg-subtle); }
.pricing-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 2rem; max-width: 960px; margin: 0 auto; }
.pricing-card { padding: 2.5rem 2rem; border-radius: var(--radius); background: var(--bg); border: 1px solid var(--border); text-align: center; position: relative; }
.pricing-featured { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
.pricing-badge { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: var(--primary); color: #fff; padding: 0.2rem 1rem; border-radius: 20px; font-size: 0.75rem; font-weight: 700; }
.pricing-card h3 { font-size: 1.25rem; font-weight: 700; margin-bottom: 1rem; }
.price { font-size: 3rem; font-weight: 800; margin-bottom: 1.5rem; }
.price span { font-size: 1rem; font-weight: 400; color: var(--text-light); }
.pricing-card ul { list-style: none; margin-bottom: 2rem; }
.pricing-card li { padding: 0.5rem 0; color: var(--text-light); font-size: 0.9rem; border-bottom: 1px solid var(--border); }
.pricing-card li:last-child { border: none; }

/* Footer */
.footer { padding: 3rem 0; text-align: center; color: var(--text-light); font-size: 0.85rem; border-top: 1px solid var(--border); }

/* Responsive */
@media (max-width: 768px) {
  .nav-links { gap: 1rem; }
  .hero { padding: 5rem 1.5rem 4rem; }
  .pricing-grid, .features-grid { grid-template-columns: 1fr; }
}`,
      'app.js': `document.addEventListener('DOMContentLoaded', () => {
  // Smooth scrolling for anchor links
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Navbar background on scroll
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      navbar.style.boxShadow = window.scrollY > 10 ? '0 1px 8px rgba(0,0,0,0.06)' : 'none';
    });
  }
});`,
    },
  },
  {
    id: 'portfolio',
    name: 'Portfolio',
    description: 'Clean portfolio for showcasing your work.',
    icon: '🎨',
    category: 'portfolio',
    thumbnail: null,
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Portfolio — Designer & Developer">
  <title>Portfolio</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header class="header">
    <nav class="nav">
      <a href="/" class="logo">YN</a>
      <div class="nav-links">
        <a href="#work">Work</a>
        <a href="#about">About</a>
        <a href="#contact">Contact</a>
      </div>
    </nav>
    <div class="hero">
      <h1>Your Name</h1>
      <p class="subtitle">Designer & Developer</p>
      <p class="bio">I build digital experiences that are beautiful, functional, and fast.</p>
    </div>
  </header>

  <section id="work" class="work">
    <h2>Selected Work</h2>
    <div class="project-grid">
      <article class="project-card">
        <div class="project-image"></div>
        <div class="project-info">
          <h3>Project One</h3>
          <p>Brand Identity & Web Design</p>
        </div>
      </article>
      <article class="project-card">
        <div class="project-image"></div>
        <div class="project-info">
          <h3>Project Two</h3>
          <p>UI/UX Design & Development</p>
        </div>
      </article>
      <article class="project-card">
        <div class="project-image"></div>
        <div class="project-info">
          <h3>Project Three</h3>
          <p>E-commerce Platform</p>
        </div>
      </article>
      <article class="project-card">
        <div class="project-image"></div>
        <div class="project-info">
          <h3>Project Four</h3>
          <p>Mobile App Design</p>
        </div>
      </article>
    </div>
  </section>

  <section id="about" class="about">
    <div class="about-content">
      <h2>About</h2>
      <p>I'm a designer and developer with 5+ years of experience building digital products. I focus on clean design, solid code, and great user experiences.</p>
    </div>
  </section>

  <section id="contact" class="contact">
    <h2>Get in Touch</h2>
    <p>Have a project in mind? Let's talk.</p>
    <a href="mailto:hello@example.com" class="btn">hello@example.com</a>
  </section>

  <footer class="footer">
    <p>&copy; 2026 Your Name</p>
  </footer>

  <script src="app.js"></script>
</body>
</html>`,
      'style.css': `*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #0a0a0a;
  --text: #fafafa;
  --text-muted: #888;
  --accent: #3b82f6;
  --surface: #141414;
  --border: #222;
  --font: 'Inter', system-ui, sans-serif;
}

body { font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.6; -webkit-font-smoothing: antialiased; }

/* Nav */
.nav { display: flex; justify-content: space-between; align-items: center; padding: 1.5rem 3rem; max-width: 1400px; margin: 0 auto; }
.logo { font-weight: 800; font-size: 1.5rem; color: var(--text); text-decoration: none; }
.nav-links { display: flex; gap: 2rem; }
.nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.9rem; transition: color 0.2s; }
.nav-links a:hover { color: var(--text); }

/* Hero */
.hero { text-align: center; padding: 8rem 2rem 6rem; }
.hero h1 { font-size: clamp(3rem, 8vw, 5rem); font-weight: 800; letter-spacing: -0.04em; }
.subtitle { color: var(--accent); font-size: 1.2rem; font-weight: 500; margin-top: 0.5rem; }
.bio { color: var(--text-muted); font-size: 1.1rem; max-width: 480px; margin: 1.5rem auto 0; }

/* Work */
.work { padding: 4rem 3rem; max-width: 1400px; margin: 0 auto; }
.work h2 { font-size: 1.5rem; font-weight: 700; margin-bottom: 2rem; }
.project-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.5rem; }
.project-card { border-radius: 16px; overflow: hidden; background: var(--surface); transition: transform 0.3s, box-shadow 0.3s; cursor: pointer; }
.project-card:hover { transform: translateY(-4px); box-shadow: 0 20px 60px rgba(0,0,0,0.4); }
.project-image { aspect-ratio: 16/10; background: linear-gradient(135deg, #1a1a2e, #16213e); }
.project-info { padding: 1.25rem 1.5rem; }
.project-info h3 { font-weight: 700; font-size: 1.1rem; margin-bottom: 0.25rem; }
.project-info p { color: var(--text-muted); font-size: 0.85rem; }

/* About */
.about { padding: 6rem 3rem; max-width: 800px; margin: 0 auto; }
.about h2 { font-size: 1.5rem; font-weight: 700; margin-bottom: 1rem; }
.about p { color: var(--text-muted); font-size: 1.05rem; line-height: 1.8; }

/* Contact */
.contact { text-align: center; padding: 6rem 2rem; }
.contact h2 { font-size: 2rem; font-weight: 800; margin-bottom: 0.5rem; }
.contact p { color: var(--text-muted); margin-bottom: 2rem; }
.btn { display: inline-block; padding: 0.75rem 2rem; background: var(--accent); color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; transition: all 0.2s; }
.btn:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(59,130,246,0.3); }

/* Footer */
.footer { text-align: center; padding: 3rem; color: var(--text-muted); font-size: 0.85rem; border-top: 1px solid var(--border); }

@media (max-width: 768px) {
  .nav { padding: 1rem 1.5rem; }
  .project-grid { grid-template-columns: 1fr; }
  .work, .about { padding: 3rem 1.5rem; }
}`,
      'app.js': `document.addEventListener('DOMContentLoaded', () => {
  // Smooth scroll
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const el = document.querySelector(a.getAttribute('href'));
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // Fade-in on scroll
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.project-card, .about-content').forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s, transform 0.6s';
    observer.observe(el);
  });
});`,
    },
  },
  {
    id: 'blog',
    name: 'Blog',
    description: 'Minimal blog template with articles list and post layout.',
    icon: '📝',
    category: 'blog',
    thumbnail: null,
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="My Blog">
  <title>Blog</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <nav class="nav">
    <a href="/" class="nav-logo">Blog</a>
    <div class="nav-links">
      <a href="/">Home</a>
      <a href="#archive">Archive</a>
      <a href="#about">About</a>
    </div>
  </nav>

  <main class="main">
    <header class="blog-header">
      <h1>Welcome to my blog</h1>
      <p>Thoughts on design, development, and everything in between.</p>
    </header>

    <section id="archive" class="posts">
      <article class="post-card">
        <time>May 7, 2026</time>
        <h2><a href="#">Getting Started with Web Development</a></h2>
        <p>A beginner's guide to building your first website from scratch using modern tools and best practices.</p>
        <div class="post-tags">
          <span class="tag">Tutorial</span>
          <span class="tag">Web Dev</span>
        </div>
      </article>
      <article class="post-card">
        <time>May 1, 2026</time>
        <h2><a href="#">Design Principles That Matter</a></h2>
        <p>The fundamental design principles every developer should understand to create better user experiences.</p>
        <div class="post-tags">
          <span class="tag">Design</span>
          <span class="tag">UX</span>
        </div>
      </article>
      <article class="post-card">
        <time>April 24, 2026</time>
        <h2><a href="#">Performance Optimization Tips</a></h2>
        <p>Practical techniques for making your websites load faster and run smoother.</p>
        <div class="post-tags">
          <span class="tag">Performance</span>
        </div>
      </article>
    </section>
  </main>

  <footer id="about" class="footer">
    <p>Built with SimpleBuild Pro</p>
  </footer>

  <script src="app.js"></script>
</body>
</html>`,
      'style.css': `*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
:root { --text: #1a1a1a; --muted: #666; --bg: #fafafa; --surface: #fff; --border: #eee; --accent: #2563eb; --font: 'Georgia', serif; --font-sans: system-ui, sans-serif; }
body { font-family: var(--font); background: var(--bg); color: var(--text); line-height: 1.8; }

.nav { display: flex; justify-content: space-between; align-items: center; padding: 1.5rem 2rem; max-width: 720px; margin: 0 auto; }
.nav-logo { font-weight: 700; font-size: 1.25rem; color: var(--text); text-decoration: none; font-family: var(--font-sans); }
.nav-links { display: flex; gap: 1.5rem; }
.nav-links a { color: var(--muted); text-decoration: none; font-family: var(--font-sans); font-size: 0.9rem; }
.nav-links a:hover { color: var(--text); }

.main { max-width: 720px; margin: 0 auto; padding: 0 2rem; }
.blog-header { padding: 4rem 0 3rem; border-bottom: 1px solid var(--border); margin-bottom: 2rem; }
.blog-header h1 { font-size: 2.5rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 0.5rem; }
.blog-header p { color: var(--muted); font-size: 1.1rem; }

.post-card { padding: 2rem 0; border-bottom: 1px solid var(--border); }
.post-card time { font-family: var(--font-sans); font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; }
.post-card h2 { font-size: 1.5rem; margin: 0.5rem 0; }
.post-card h2 a { color: var(--text); text-decoration: none; }
.post-card h2 a:hover { color: var(--accent); }
.post-card p { color: var(--muted); font-size: 1rem; }
.post-tags { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
.tag { font-family: var(--font-sans); font-size: 0.7rem; padding: 0.2rem 0.6rem; background: #f0f0f0; border-radius: 4px; color: var(--muted); }

.footer { max-width: 720px; margin: 4rem auto; padding: 2rem; text-align: center; color: var(--muted); font-size: 0.85rem; font-family: var(--font-sans); border-top: 1px solid var(--border); }`,
      'app.js': `document.addEventListener('DOMContentLoaded', () => {
  console.log('Blog loaded.');
});`,
    },
  },
  {
    id: 'business',
    name: 'Business',
    description: 'Professional business website with services and contact form.',
    icon: '💼',
    category: 'business',
    thumbnail: null,
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Professional services for your business.">
  <title>Business Name</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <nav class="navbar">
    <div class="container nav-container">
      <a href="/" class="logo">Business</a>
      <div class="nav-links">
        <a href="#services">Services</a>
        <a href="#testimonials">Testimonials</a>
        <a href="#contact">Contact</a>
      </div>
    </div>
  </nav>

  <header class="hero">
    <div class="container">
      <h1>Professional Solutions<br>for Growing Businesses</h1>
      <p>We help companies scale with strategy, design, and technology.</p>
      <a href="#contact" class="btn">Schedule a Call</a>
    </div>
  </header>

  <section id="services" class="services">
    <div class="container">
      <h2>Our Services</h2>
      <div class="services-grid">
        <div class="service-card">
          <h3>Strategy</h3>
          <p>Data-driven strategies that align with your business goals and market opportunity.</p>
        </div>
        <div class="service-card">
          <h3>Design</h3>
          <p>User-centered design that converts visitors into customers and builds brand loyalty.</p>
        </div>
        <div class="service-card">
          <h3>Development</h3>
          <p>Scalable web applications built with modern technology and best practices.</p>
        </div>
      </div>
    </div>
  </section>

  <section id="testimonials" class="testimonials">
    <div class="container">
      <h2>What our clients say</h2>
      <blockquote>
        <p>"They transformed our online presence and helped us grow revenue by 300% in 12 months."</p>
        <cite>— Client Name, CEO at Company</cite>
      </blockquote>
    </div>
  </section>

  <section id="contact" class="contact">
    <div class="container">
      <h2>Let's work together</h2>
      <form class="contact-form" id="contactForm">
        <input type="text" name="name" placeholder="Your name" required>
        <input type="email" name="email" placeholder="Your email" required>
        <textarea name="message" placeholder="Tell us about your project" rows="4" required></textarea>
        <button type="submit" class="btn">Send Message</button>
      </form>
    </div>
  </section>

  <footer class="footer">
    <div class="container">
      <p>&copy; 2026 Business Name. All rights reserved.</p>
    </div>
  </footer>

  <script src="app.js"></script>
</body>
</html>`,
      'style.css': `*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
:root { --primary: #0f172a; --accent: #3b82f6; --text: #1e293b; --muted: #64748b; --bg: #fff; --surface: #f8fafc; --border: #e2e8f0; --font: system-ui, sans-serif; }
body { font-family: var(--font); color: var(--text); background: var(--bg); line-height: 1.6; }
.container { max-width: 1100px; margin: 0 auto; padding: 0 2rem; }

.navbar { background: var(--primary); color: #fff; }
.nav-container { display: flex; justify-content: space-between; align-items: center; height: 64px; }
.logo { color: #fff; font-weight: 800; font-size: 1.25rem; text-decoration: none; }
.nav-links { display: flex; gap: 2rem; }
.nav-links a { color: #94a3b8; text-decoration: none; font-size: 0.9rem; transition: color 0.2s; }
.nav-links a:hover { color: #fff; }

.hero { background: var(--primary); color: #fff; padding: 8rem 0 6rem; text-align: center; }
.hero h1 { font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 800; letter-spacing: -0.02em; margin-bottom: 1rem; }
.hero p { color: #94a3b8; font-size: 1.15rem; margin-bottom: 2rem; }

.btn { display: inline-block; padding: 0.75rem 2rem; background: var(--accent); color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 0.95rem; border: none; cursor: pointer; transition: all 0.2s; }
.btn:hover { background: #2563eb; transform: translateY(-1px); }

.services { padding: 6rem 0; }
.services h2 { font-size: 2rem; font-weight: 800; text-align: center; margin-bottom: 3rem; }
.services-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 2rem; }
.service-card { padding: 2rem; border: 1px solid var(--border); border-radius: 12px; }
.service-card h3 { font-size: 1.2rem; margin-bottom: 0.75rem; }
.service-card p { color: var(--muted); font-size: 0.95rem; }

.testimonials { padding: 6rem 0; background: var(--surface); text-align: center; }
.testimonials h2 { font-size: 2rem; font-weight: 800; margin-bottom: 2rem; }
blockquote p { font-size: 1.3rem; font-style: italic; max-width: 640px; margin: 0 auto 1rem; color: var(--text); }
cite { color: var(--muted); font-size: 0.9rem; font-style: normal; }

.contact { padding: 6rem 0; text-align: center; }
.contact h2 { font-size: 2rem; font-weight: 800; margin-bottom: 2rem; }
.contact-form { max-width: 480px; margin: 0 auto; display: flex; flex-direction: column; gap: 1rem; }
.contact-form input, .contact-form textarea { padding: 0.75rem 1rem; border: 1px solid var(--border); border-radius: 8px; font-size: 0.95rem; font-family: inherit; }
.contact-form input:focus, .contact-form textarea:focus { outline: none; border-color: var(--accent); }

.footer { padding: 3rem 0; text-align: center; color: var(--muted); font-size: 0.85rem; border-top: 1px solid var(--border); }

@media (max-width: 768px) { .services-grid { grid-template-columns: 1fr; } }`,
      'app.js': `document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const data = Object.fromEntries(formData.entries());
      console.log('Form submitted:', data);
      // In production, this would POST to your API
      form.reset();
      alert('Message sent! We will get back to you soon.');
    });
  }
});`,
    },
  },
];
