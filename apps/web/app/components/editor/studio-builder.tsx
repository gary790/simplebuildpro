// ============================================================
// SimpleBuild Pro — Studio Builder Component
// Visual drag-and-drop component library integrated into editor
// Provides a WYSIWYG layer on top of the code editor
// ============================================================

'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useEditorStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import {
  Type,
  Image,
  Square,
  Columns,
  List,
  Link2,
  Code,
  Undo2,
  Redo2,
  Eye,
  EyeOff,
  Smartphone,
  Tablet,
  Monitor,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Bold,
  Italic,
  Underline,
  Palette,
  Move,
  Trash2,
  Copy,
  ChevronDown,
  Layers,
  Plus,
  Layout,
  MousePointer,
  Hand,
  Grid3x3,
  Video,
  FormInput,
  Heading1,
  Heading2,
  Heading3,
  ListOrdered,
  Quote,
  Minus,
  CircleDot,
  ToggleLeft,
  Table,
  Map,
  Star,
  MessageSquare,
  Navigation,
  PanelBottom as FooterIcon,
  SlidersHorizontal,
  Lock,
} from 'lucide-react';
import clsx from 'clsx';

// ─── Component Library ────────────────────────────────────────
interface BuilderComponent {
  id: string;
  type: string;
  label: string;
  icon: React.ReactNode;
  category: 'layout' | 'text' | 'media' | 'form' | 'interactive' | 'navigation';
  defaultHtml: string;
  defaultCss?: string;
}

const COMPONENT_LIBRARY: BuilderComponent[] = [
  // Layout
  {
    id: 'section',
    type: 'section',
    label: 'Section',
    icon: <Layout size={14} />,
    category: 'layout',
    defaultHtml:
      '<section class="py-16 px-6">\n  <div class="max-w-6xl mx-auto">\n    <h2 class="text-3xl font-bold mb-6">Section Title</h2>\n    <p class="text-gray-600">Section content goes here.</p>\n  </div>\n</section>',
  },
  {
    id: 'container',
    type: 'div',
    label: 'Container',
    icon: <Square size={14} />,
    category: 'layout',
    defaultHtml: '<div class="max-w-6xl mx-auto px-6">\n  <!-- Content -->\n</div>',
  },
  {
    id: 'grid-2col',
    type: 'grid',
    label: '2 Columns',
    icon: <Columns size={14} />,
    category: 'layout',
    defaultHtml:
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-8">\n  <div class="p-6 bg-white rounded-lg shadow">\n    <h3 class="font-bold mb-2">Column 1</h3>\n    <p class="text-gray-600">Content here</p>\n  </div>\n  <div class="p-6 bg-white rounded-lg shadow">\n    <h3 class="font-bold mb-2">Column 2</h3>\n    <p class="text-gray-600">Content here</p>\n  </div>\n</div>',
  },
  {
    id: 'grid-3col',
    type: 'grid',
    label: '3 Columns',
    icon: <Grid3x3 size={14} />,
    category: 'layout',
    defaultHtml:
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-6">\n  <div class="p-6 bg-white rounded-lg shadow">\n    <h3 class="font-bold mb-2">Column 1</h3>\n    <p class="text-gray-600">Content</p>\n  </div>\n  <div class="p-6 bg-white rounded-lg shadow">\n    <h3 class="font-bold mb-2">Column 2</h3>\n    <p class="text-gray-600">Content</p>\n  </div>\n  <div class="p-6 bg-white rounded-lg shadow">\n    <h3 class="font-bold mb-2">Column 3</h3>\n    <p class="text-gray-600">Content</p>\n  </div>\n</div>',
  },
  {
    id: 'divider',
    type: 'hr',
    label: 'Divider',
    icon: <Minus size={14} />,
    category: 'layout',
    defaultHtml: '<hr class="my-8 border-gray-200" />',
  },

  // Text
  {
    id: 'heading1',
    type: 'h1',
    label: 'Heading 1',
    icon: <Heading1 size={14} />,
    category: 'text',
    defaultHtml: '<h1 class="text-4xl font-bold text-gray-900 mb-4">Main Heading</h1>',
  },
  {
    id: 'heading2',
    type: 'h2',
    label: 'Heading 2',
    icon: <Heading2 size={14} />,
    category: 'text',
    defaultHtml: '<h2 class="text-3xl font-bold text-gray-900 mb-3">Section Heading</h2>',
  },
  {
    id: 'heading3',
    type: 'h3',
    label: 'Heading 3',
    icon: <Heading3 size={14} />,
    category: 'text',
    defaultHtml: '<h3 class="text-xl font-semibold text-gray-900 mb-2">Sub Heading</h3>',
  },
  {
    id: 'paragraph',
    type: 'p',
    label: 'Paragraph',
    icon: <Type size={14} />,
    category: 'text',
    defaultHtml:
      '<p class="text-gray-600 leading-relaxed mb-4">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>',
  },
  {
    id: 'blockquote',
    type: 'blockquote',
    label: 'Quote',
    icon: <Quote size={14} />,
    category: 'text',
    defaultHtml:
      '<blockquote class="border-l-4 border-blue-500 pl-6 py-2 my-6 text-gray-700 italic">\n  "The best way to predict the future is to create it."\n  <cite class="block mt-2 text-sm text-gray-500 not-italic">— Peter Drucker</cite>\n</blockquote>',
  },
  {
    id: 'list-ul',
    type: 'ul',
    label: 'Bullet List',
    icon: <List size={14} />,
    category: 'text',
    defaultHtml:
      '<ul class="list-disc list-inside space-y-2 text-gray-600 mb-4">\n  <li>First item</li>\n  <li>Second item</li>\n  <li>Third item</li>\n</ul>',
  },
  {
    id: 'list-ol',
    type: 'ol',
    label: 'Numbered List',
    icon: <ListOrdered size={14} />,
    category: 'text',
    defaultHtml:
      '<ol class="list-decimal list-inside space-y-2 text-gray-600 mb-4">\n  <li>First step</li>\n  <li>Second step</li>\n  <li>Third step</li>\n</ol>',
  },

  // Media
  {
    id: 'image',
    type: 'img',
    label: 'Image',
    icon: <Image size={14} />,
    category: 'media',
    defaultHtml:
      '<figure class="mb-6">\n  <img src="https://via.placeholder.com/800x400" alt="Description" class="w-full rounded-lg shadow-md" />\n  <figcaption class="mt-2 text-sm text-gray-500 text-center">Image caption</figcaption>\n</figure>',
  },
  {
    id: 'video',
    type: 'video',
    label: 'Video Embed',
    icon: <Video size={14} />,
    category: 'media',
    defaultHtml:
      '<div class="aspect-video mb-6">\n  <iframe class="w-full h-full rounded-lg" src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen></iframe>\n</div>',
  },

  // Form
  {
    id: 'form',
    type: 'form',
    label: 'Form',
    icon: <FormInput size={14} />,
    category: 'form',
    defaultHtml:
      '<form class="max-w-md mx-auto space-y-4">\n  <div>\n    <label class="block text-sm font-medium text-gray-700 mb-1">Name</label>\n    <input type="text" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="Your name" />\n  </div>\n  <div>\n    <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>\n    <input type="email" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="you@example.com" />\n  </div>\n  <div>\n    <label class="block text-sm font-medium text-gray-700 mb-1">Message</label>\n    <textarea rows="4" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent" placeholder="Your message"></textarea>\n  </div>\n  <button type="submit" class="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors">Send Message</button>\n</form>',
  },
  {
    id: 'button',
    type: 'button',
    label: 'Button',
    icon: <CircleDot size={14} />,
    category: 'form',
    defaultHtml:
      '<a href="#" class="inline-block bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors">Get Started</a>',
  },

  // Interactive
  {
    id: 'card',
    type: 'card',
    label: 'Card',
    icon: <Square size={14} />,
    category: 'interactive',
    defaultHtml:
      '<div class="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow">\n  <img src="https://via.placeholder.com/400x200" alt="" class="w-full h-48 object-cover" />\n  <div class="p-6">\n    <h3 class="font-bold text-lg mb-2">Card Title</h3>\n    <p class="text-gray-600 text-sm mb-4">Card description goes here with more detail.</p>\n    <a href="#" class="text-blue-600 font-medium text-sm hover:underline">Learn more →</a>\n  </div>\n</div>',
  },
  {
    id: 'testimonial',
    type: 'testimonial',
    label: 'Testimonial',
    icon: <MessageSquare size={14} />,
    category: 'interactive',
    defaultHtml:
      '<div class="bg-white p-6 rounded-xl shadow-md">\n  <div class="flex items-center gap-1 mb-3">\n    <span class="text-yellow-400">★★★★★</span>\n  </div>\n  <p class="text-gray-700 mb-4">"This product has completely transformed our workflow. Highly recommended!"</p>\n  <div class="flex items-center gap-3">\n    <div class="w-10 h-10 bg-gray-300 rounded-full"></div>\n    <div>\n      <p class="font-semibold text-sm">Jane Doe</p>\n      <p class="text-gray-500 text-xs">CEO, Acme Inc.</p>\n    </div>\n  </div>\n</div>',
  },
  {
    id: 'pricing',
    type: 'pricing',
    label: 'Pricing Card',
    icon: <Star size={14} />,
    category: 'interactive',
    defaultHtml:
      '<div class="bg-white border-2 border-blue-500 rounded-xl p-8 text-center shadow-lg">\n  <h3 class="text-lg font-bold text-gray-900 mb-2">Pro Plan</h3>\n  <p class="text-4xl font-extrabold text-gray-900 mb-1">$29<span class="text-lg font-normal text-gray-500">/mo</span></p>\n  <p class="text-gray-500 text-sm mb-6">Best for growing teams</p>\n  <ul class="text-left space-y-3 mb-8">\n    <li class="flex items-center gap-2 text-sm text-gray-600">✓ Unlimited projects</li>\n    <li class="flex items-center gap-2 text-sm text-gray-600">✓ Priority support</li>\n    <li class="flex items-center gap-2 text-sm text-gray-600">✓ Custom domains</li>\n  </ul>\n  <button class="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors">Choose Plan</button>\n</div>',
  },

  // Navigation
  {
    id: 'navbar',
    type: 'nav',
    label: 'Navbar',
    icon: <Navigation size={14} />,
    category: 'navigation',
    defaultHtml:
      '<nav class="bg-white shadow-sm border-b">\n  <div class="max-w-6xl mx-auto px-6 flex items-center justify-between h-16">\n    <a href="#" class="text-xl font-bold text-gray-900">Brand</a>\n    <div class="hidden md:flex items-center gap-8">\n      <a href="#" class="text-gray-600 hover:text-gray-900 text-sm font-medium">Home</a>\n      <a href="#" class="text-gray-600 hover:text-gray-900 text-sm font-medium">Features</a>\n      <a href="#" class="text-gray-600 hover:text-gray-900 text-sm font-medium">Pricing</a>\n      <a href="#" class="text-gray-600 hover:text-gray-900 text-sm font-medium">Contact</a>\n    </div>\n    <a href="#" class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">Sign Up</a>\n  </div>\n</nav>',
  },
  {
    id: 'hero',
    type: 'hero',
    label: 'Hero Section',
    icon: <Layout size={14} />,
    category: 'navigation',
    defaultHtml:
      '<section class="bg-gradient-to-br from-blue-600 to-indigo-700 text-white py-24 px-6">\n  <div class="max-w-4xl mx-auto text-center">\n    <h1 class="text-5xl font-extrabold mb-6 leading-tight">Build Something Amazing</h1>\n    <p class="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">Create beautiful, responsive websites in minutes with our powerful visual builder.</p>\n    <div class="flex items-center justify-center gap-4">\n      <a href="#" class="bg-white text-blue-600 px-8 py-3 rounded-lg font-bold hover:bg-blue-50 transition-colors">Get Started Free</a>\n      <a href="#" class="border-2 border-white text-white px-8 py-3 rounded-lg font-bold hover:bg-white/10 transition-colors">Learn More</a>\n    </div>\n  </div>\n</section>',
  },
  {
    id: 'footer',
    type: 'footer',
    label: 'Footer',
    icon: <FooterIcon size={14} />,
    category: 'navigation',
    defaultHtml:
      '<footer class="bg-gray-900 text-gray-400 py-12 px-6">\n  <div class="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">\n    <div>\n      <h3 class="text-white font-bold text-lg mb-4">Brand</h3>\n      <p class="text-sm">Building the future of the web, one site at a time.</p>\n    </div>\n    <div>\n      <h4 class="text-white font-semibold mb-3">Product</h4>\n      <ul class="space-y-2 text-sm"><li><a href="#" class="hover:text-white">Features</a></li><li><a href="#" class="hover:text-white">Pricing</a></li><li><a href="#" class="hover:text-white">Templates</a></li></ul>\n    </div>\n    <div>\n      <h4 class="text-white font-semibold mb-3">Company</h4>\n      <ul class="space-y-2 text-sm"><li><a href="#" class="hover:text-white">About</a></li><li><a href="#" class="hover:text-white">Blog</a></li><li><a href="#" class="hover:text-white">Careers</a></li></ul>\n    </div>\n    <div>\n      <h4 class="text-white font-semibold mb-3">Legal</h4>\n      <ul class="space-y-2 text-sm"><li><a href="#" class="hover:text-white">Privacy</a></li><li><a href="#" class="hover:text-white">Terms</a></li><li><a href="#" class="hover:text-white">Contact</a></li></ul>\n    </div>\n  </div>\n  <div class="max-w-6xl mx-auto mt-8 pt-8 border-t border-gray-800 text-center text-sm">\n    <p>&copy; 2026 Brand. All rights reserved.</p>\n  </div>\n</footer>',
  },
];

// ─── Category Grouping ────────────────────────────────────────
const CATEGORIES = [
  { id: 'layout', label: 'Layout', icon: <Layout size={13} /> },
  { id: 'text', label: 'Text', icon: <Type size={13} /> },
  { id: 'media', label: 'Media', icon: <Image size={13} /> },
  { id: 'form', label: 'Form', icon: <FormInput size={13} /> },
  { id: 'interactive', label: 'Interactive', icon: <Layers size={13} /> },
  { id: 'navigation', label: 'Navigation', icon: <Navigation size={13} /> },
] as const;

// ─── Device presets ───────────────────────────────────────────
type DeviceMode = 'desktop' | 'tablet' | 'mobile';
const DEVICE_WIDTHS: Record<DeviceMode, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '375px',
};

// ─── Props ────────────────────────────────────────────────────
interface StudioBuilderProps {
  onInsertHtml: (html: string) => void;
  onSwitchToCode: () => void;
}

export function StudioBuilder({ onInsertHtml, onSwitchToCode }: StudioBuilderProps) {
  const { files, activeFile, project } = useEditorStore();

  const [activeCategory, setActiveCategory] = useState<string>('layout');
  const [device, setDevice] = useState<DeviceMode>('desktop');
  const [showGrid, setShowGrid] = useState(false);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [searchComponents, setSearchComponents] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Get current HTML content
  const currentHtml = activeFile ? files.get(activeFile) || '' : '';

  // Filter components by search and category
  const filteredComponents = COMPONENT_LIBRARY.filter((c) => {
    const matchesCategory = c.category === activeCategory;
    const matchesSearch =
      !searchComponents ||
      c.label.toLowerCase().includes(searchComponents.toLowerCase()) ||
      c.type.toLowerCase().includes(searchComponents.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Insert component HTML into current file
  const handleInsertComponent = useCallback(
    (component: BuilderComponent) => {
      // Push current state to undo stack
      setUndoStack((prev) => [...prev.slice(-50), currentHtml]);
      setRedoStack([]);

      // Insert at end of body or before </body>
      const html = component.defaultHtml;

      // If we have Tailwind, include the CDN
      if (currentHtml && !currentHtml.includes('tailwindcss')) {
        toast(
          'info',
          'Tip: Add Tailwind CSS CDN for best results',
          'Components use Tailwind classes. Add <script src="https://cdn.tailwindcss.com"></script> to your <head>.',
        );
      }

      onInsertHtml(html);
      toast('success', `Inserted: ${component.label}`);
    },
    [currentHtml, onInsertHtml],
  );

  // Undo/Redo
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setRedoStack((s) => [...s, currentHtml]);
    onInsertHtml(prev);
  }, [undoStack, currentHtml, onInsertHtml]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setUndoStack((s) => [...s, currentHtml]);
    onInsertHtml(next);
  }, [redoStack, currentHtml, onInsertHtml]);

  // Update preview iframe
  useEffect(() => {
    if (!iframeRef.current) return;
    const doc = iframeRef.current.contentDocument;
    if (!doc) return;

    // Build full HTML with all project files
    let html = currentHtml;

    // If the HTML doesn't include <!DOCTYPE, wrap it
    if (html && !html.toLowerCase().includes('<!doctype')) {
      html = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<script src="https://cdn.tailwindcss.com"></script>\n</head>\n<body>\n${html}\n</body>\n</html>`;
    }

    doc.open();
    doc.write(html);
    doc.close();

    // Add grid overlay
    if (showGrid) {
      const style = doc.createElement('style');
      style.textContent = `
        * { outline: 1px dashed rgba(59, 130, 246, 0.3) !important; }
        *:hover { outline: 2px solid rgba(59, 130, 246, 0.6) !important; }
      `;
      doc.head?.appendChild(style);
    }
  }, [currentHtml, showGrid]);

  // Check if current file is HTML
  const isHtmlFile = activeFile?.endsWith('.html') || activeFile?.endsWith('.htm');

  if (!isHtmlFile) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#1E1E1E] text-slate-400">
        <div className="text-center">
          <Layout size={32} className="mx-auto mb-3 text-slate-600" />
          <p className="text-sm mb-2">Visual Builder is only available for HTML files.</p>
          <p className="text-xs text-slate-600">
            Open an .html file to use the visual component library.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden bg-[#1E1E1E]">
      {/* ─── Left: Component Library ──────────────────────── */}
      <div className="w-56 bg-[#252526] border-r border-[#1E1E1E] flex flex-col overflow-hidden shrink-0">
        {/* Search */}
        <div className="p-2 border-b border-[#1E1E1E]">
          <input
            type="text"
            value={searchComponents}
            onChange={(e) => setSearchComponents(e.target.value)}
            placeholder="Search components..."
            className="w-full px-2.5 py-1.5 text-xs bg-[#3C3C3C] border border-[#5A5A5A] rounded text-slate-300 placeholder-slate-500 focus:outline-none focus:border-brand-500"
          />
        </div>

        {/* Category Tabs */}
        <div className="flex flex-wrap gap-1 p-2 border-b border-[#1E1E1E]">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={clsx(
                'flex items-center gap-1 px-2 py-1 rounded text-2xs font-medium transition-colors',
                activeCategory === cat.id
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-400 hover:text-slate-300 hover:bg-white/5',
              )}
            >
              {cat.icon}
              {cat.label}
            </button>
          ))}
        </div>

        {/* Component List */}
        <div className="flex-1 overflow-y-auto dark-scroll p-2 space-y-1">
          {filteredComponents.map((comp) => (
            <button
              key={comp.id}
              onClick={() => handleInsertComponent(comp)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs text-slate-300 hover:bg-white/10 hover:text-white transition-colors text-left group"
              title={`Click to insert ${comp.label}`}
            >
              <span className="text-slate-500 group-hover:text-brand-400 transition-colors">
                {comp.icon}
              </span>
              <span>{comp.label}</span>
              <Plus
                size={10}
                className="ml-auto opacity-0 group-hover:opacity-100 text-brand-400 transition-opacity"
              />
            </button>
          ))}
          {filteredComponents.length === 0 && (
            <p className="text-xs text-slate-600 text-center py-4">No components found</p>
          )}
        </div>
      </div>

      {/* ─── Center: Visual Preview ──────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-3 h-9 bg-[#252526] border-b border-[#1E1E1E] shrink-0">
          <div className="flex items-center gap-1">
            {/* Undo / Redo */}
            <button
              onClick={handleUndo}
              disabled={undoStack.length === 0}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Undo"
            >
              <Undo2 size={13} />
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Redo"
            >
              <Redo2 size={13} />
            </button>

            <div className="w-px h-4 bg-white/10 mx-1" />

            {/* Grid toggle */}
            <button
              onClick={() => setShowGrid(!showGrid)}
              className={clsx(
                'p-1.5 rounded transition-colors',
                showGrid
                  ? 'bg-brand-600/20 text-brand-400'
                  : 'text-slate-400 hover:text-white hover:bg-white/10',
              )}
              title="Toggle grid outline"
            >
              <Grid3x3 size={13} />
            </button>
          </div>

          {/* Device Switcher */}
          <div className="flex items-center gap-1">
            {[
              { mode: 'desktop' as const, icon: <Monitor size={13} /> },
              { mode: 'tablet' as const, icon: <Tablet size={13} /> },
              { mode: 'mobile' as const, icon: <Smartphone size={13} /> },
            ].map(({ mode, icon }) => (
              <button
                key={mode}
                onClick={() => setDevice(mode)}
                className={clsx(
                  'p-1.5 rounded transition-colors',
                  device === mode
                    ? 'bg-white/20 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/10',
                )}
                title={mode}
              >
                {icon}
              </button>
            ))}
          </div>

          {/* Switch to Code */}
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant="ghost"
              onClick={onSwitchToCode}
              icon={<Code size={13} />}
              className="text-slate-400 hover:text-white"
            >
              Code View
            </Button>
          </div>
        </div>

        {/* Preview Frame */}
        <div className="flex-1 overflow-auto bg-[#1E1E1E] flex justify-center p-4">
          <div
            className="bg-white shadow-2xl rounded-lg overflow-hidden transition-all duration-300"
            style={{
              width: DEVICE_WIDTHS[device],
              maxWidth: '100%',
              minHeight: '600px',
            }}
          >
            <iframe
              ref={iframeRef}
              className="w-full h-full min-h-[600px] border-0"
              title="Studio Preview"
              sandbox="allow-scripts allow-same-origin"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
