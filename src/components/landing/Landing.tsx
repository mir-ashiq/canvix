'use client'

import { useState } from 'react'
import {
  ArrowRight,
  Github,
  Shapes,
  Type,
  Image as ImageIcon,
  Download,
  Smartphone,
  Layers,
  Sparkles,
  Palette,
  Undo2,
  عرض تقديمي,
  Instagram,
  Printer,
  Video,
  BadgeCheck,
  Heart,
  Star,
  Users,
  Bot,
  Server,
  ChevronDown,
  Check,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { شعار } from '@/components/logo'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth/client'

// ── Editor mockup (pure CSS, zero assets) ────────────────────

function EditorMockup() {
  return (
    <div className="relative w-full aspect-[16/10] rounded-2xl border border-black/10 bg-white shadow-2xl shadow-violet-900/10 overflow-hidden">
      {/* window chrome */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-[#F4F5F7] border-b border-black/5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#FF5C8A]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#FFD166]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#34C77B]" />
        <span className="ml-3 flex-1 max-w-[280px] h-4 rounded bg-white border border-black/5" />
      </div>
      <div className="flex h-[calc(100%-37px)]">
        {/* dark rail */}
        <div className="w-12 bg-[#17181D] flex flex-col items-center pt-3 gap-3">
          {[عرض تقديمي, Shapes, Type, ImageIcon, Layers].map((Icon, i) => (
            <div
              key={i}
              className={`h-8 w-8 rounded-lg flex items-center justify-center ${
                i === 0 ? 'bg-[#26272E] text-white' : 'text-white/45'
              }`}
            >
              <Icon size={15} />
            </div>
          ))}
        </div>
        {/* panel */}
        <div className="w-16 sm:w-24 bg-white border-r border-black/5 p-2 grid grid-cols-2 gap-2 content-start">
          {['#FF5C8A', '#00C4CC', '#7D2AE8', '#FFD166', '#34C77B', '#0F4C4C'].map((c) => (
            <div key={c} className="aspect-square rounded-md" style={{ background: c }} />
          ))}
        </div>
        {/* canvas workspace */}
        <div className="flex-1 bg-[#E9EAF0] flex items-center justify-center p-4">
          <div className="relative w-52 h-40 sm:w-64 sm:h-48 rounded-lg overflow-hidden shadow-lg" style={{ background: 'linear-gradient(135deg,#FF5C8A,#FFB84C)' }}>
            <div className="absolute top-3 left-3 w-8 h-8 rounded bg-white/80 animate-float" />
            <div className="absolute top-9 left-3 right-3">
              <div className="h-4 rounded bg-white/90 mb-1.5" style={{ width: '70%' }} />
              <div className="h-4 rounded bg-white/70" style={{ width: '45%' }} />
            </div>
            <div className="absolute bottom-3 left-3 h-4 w-20 rounded-full bg-[#1F2226]" />
            <div className="absolute -bottom-2 -right-2 text-4xl">✨</div>
            {/* selection handles */}
            <div className="absolute inset-3 border-2 border-[#00C4CC] rounded">
              {['-top-1 -left-1', '-top-1 -right-1', '-bottom-1 -left-1', '-bottom-1 -right-1'].map((pos) => (
                <span key={pos} className={`absolute ${pos} h-2.5 w-2.5 rounded-full bg-[#00C4CC] border-2 border-white`} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Feature cards ────────────────────────────────────────────

const FEATURES = [
  {
    icon: Shapes,
    title: 'Drag-and-drop editor',
    text: 'Shapes, lines, graphics, stickers and images — move, resize and rotate everything with buttery-smooth canvas rendering.',
  },
  {
    icon: Type,
    title: 'Beautiful typography',
    text: '369 hand-picked Google Fonts with on-demand loading, styles and pairings. Bold, italic, spacing, alignment and colors at your fingertips.',
  },
  {
    icon: Palette,
    title: 'القوالب for everything',
    text: 'All 366 templates are free — منشور إنستغرامs, stories, pitch decks, posters, logos and thumbnails. Start from a template, make it yours.',
  },
  {
    icon: Layers,
    title: 'Layers & smart guides',
    text: 'Reorder layers, lock elements and snap things into perfect alignment with magenta smart guides.',
  },
  {
    icon: Undo2,
    title: 'Undo, redo & autosave',
    text: 'A full history stack with keyboard shortcuts, plus automatic saving so your work is never lost.',
  },
  {
    icon: Download,
    title: 'Export anywhere',
    text: 'PNG, JPG, WebP, SVG, PDF, PPTX, even GIF and video — crisp up to 3× resolution. دون علامات مائية.',
  },
  {
    icon: Smartphone,
    title: 'Works on every device',
    text: 'The same editor adapts from desktop workstations to tablets and phones with touch-native interactions.',
  },
  {
    icon: Heart,
    title: 'Free & open source',
    text: 'MIT licensed, self-hostable, community-driven. No accounts, no paywalls, no locked premium elements.',
  },
]

/** v0.26: the three big differentiators — real-time collab, AI with your
 *  own key, and one-command self-hosting. Each maps to something the
 *  commercial tools charge for or lock away. */
const BIG_FEATURES = [
  {
    icon: Users,
    title: 'Real-time collaboration',
    text: 'Invite anyone with a link and design together live — cursors, selections and edits sync instantly. No seat pricing, no viewer limits, no “upgrade to invite more editors”.',
    accent: 'from-[#02C0CC] to-[#0090AA]',
  },
  {
    icon: Bot,
    title: 'AI that works for you',
    text: 'A design-aware assistant that fixes overlaps and balances layouts automatically, background remover, magic eraser, auto-adjust and more. Bring your own API key — or run the local on-device engines with zero setup.',
    accent: 'from-[#7630D7] to-[#9B6BFF]',
  },
  {
    icon: Server,
    title: 'Self-host in one command',
    text: 'Your designs live in your own Postgres. One docker compose command and the whole platform — editor, collab, templates — runs on your hardware, forever.',
    accent: 'from-[#FF5C8A] to-[#FF8A5C]',
  },
]

const TEMPLATE_SHOWCASE = [
  { label: 'منشور إنستغرام', from: '#FF5C8A', to: '#FFB84C', icon: Instagram, title: 'MEGA SALE' },
  { label: 'قصة', from: '#B8E986', to: '#7ED957', icon: Instagram, title: 'NEW DROP' },
  { label: 'عرض تقديمي', from: '#FFFFFF', to: '#E8F6F7', icon: عرض تقديمي, title: 'Nimbus', dark: true },
  { label: 'ملصق', from: '#FFD166', to: '#FFC93C', icon: Printer, title: 'LIVE MUSIC', dark: true },
  { label: 'صورة مصغّرة', from: '#0D1117', to: '#161B22', icon: Video, title: 'TOP 10 AI' },
  { label: 'شعار', from: '#FFFFFF', to: '#F4F5F7', icon: BadgeCheck, title: 'NOVA', dark: true },
]

/** v0.26: short الأسئلة الشائعة answering the questions new visitors actually ask. */
const الأسئلة الشائعة = [
  {
    q: 'هل هو مجاني حقاً؟ وما المقابل؟',
    a: 'مجاني بالكامل بترخيص MIT. لا توجد باقات مدفوعة أو علامات مائية أو حدود للتصدير أو عناصر مقفلة. النسخة المستضافة هي نفس الشيفرة التي يمكنك استضافتها بنفسك.',
  },
  {
    q: 'هل أحتاج إلى حساب؟',
    a: 'لا. يمكنك فتح المحرر والبدء بالتصميم فوراً. الحسابات مجانية واختيارية، وتساعدك على حفظ تصاميمك ومزامنتها بين أجهزتك.',
  },
  {
    q: 'كيف يعمل الذكاء الاصطناعي مع الحفاظ على خصوصيتي؟',
    a: 'تعمل بعض ميزات الذكاء الاصطناعي محلياً داخل المتصفح. أما المحركات المرتبطة بمزوّد خارجي فتعمل عبر الخادم، ويمكنك استخدام مفتاح API الخاص بك.',
  },
  {
    q: 'هل يمكن لوكلاء الذكاء الاصطناعي استخدام TEa.G3؟',
    a: 'نعم، يتضمن TEa.G3 خادماً لبروتوكول MCP. يمكنك ربط Claude أو Cursor أو أي عميل MCP بحسابك لإدارة تصاميمك.',
  },
  {
    q: 'ما صيغ التصدير المتاحة؟',
    a: 'PNG وJPG وWebP وSVG وPDF وPPTX وGIF والفيديو، بدقة تصل إلى ثلاثة أضعاف ودون علامات مائية.',
  },
  {
    q: 'كيف أستضيفه بنفسي؟',
    a: 'استنسخ المستودع باستخدام git clone ثم شغّل أمر Docker Compose. تُحفظ التصاميم في قاعدة بيانات PostgreSQL الخاصة بك.',
  },
]

function FaqItem({ q, a, defaultOpen = false }: { q: string; a: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-2xl border border-black/8 bg-white overflow-hidden">
      <button
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="text-[15px] font-bold">{q}</span>
        <ChevronDown size={17} className={`shrink-0 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed">{a}</p>}
    </div>
  )
}

export function Landing() {
  const goDashboard = useAppStore((s) => s.goDashboard)
  const { user } = useAuth()

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 border-b border-black/5 bg-white/80 backdrop-blur-lg">
        <nav className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="الصفحة الرئيسية لـ TEa.G3">
            <شعار size={30} />
          </button>
          <div className="hidden md:flex items-center gap-1 text-sm font-medium text-muted-foreground">
            <a href="#features" className="px-3 py-2 rounded-lg hover:bg-black/5 hover:text-foreground transition">المميزات</a>
            <a href="#collab" className="px-3 py-2 rounded-lg hover:bg-black/5 hover:text-foreground transition">التعاون</a>
            <a href="#templates" className="px-3 py-2 rounded-lg hover:bg-black/5 hover:text-foreground transition">القوالب</a>
            <a href="#faq" className="px-3 py-2 rounded-lg hover:bg-black/5 hover:text-foreground transition">الأسئلة الشائعة</a>
            <a href="#opensource" className="px-3 py-2 rounded-lg hover:bg-black/5 hover:text-foreground transition">مفتوح المصدر</a>
          </div>
          <div className="flex items-center gap-2">
            <a href="https://github.com/TEaG3/eng-salman" target="_blank" rel="noreferrer">
              <Button variant="ghost" size="sm" className="rounded-full gap-1.5">
                <Github size={16} /> <span className="hidden sm:inline">GitHub</span>
              </Button>
            </a>
            {user && (
              <span className="hidden sm:inline text-xs font-medium text-muted-foreground">
                @{user.username}
              </span>
            )}
            <Button size="sm" className="btn-brand-gradient rounded-full px-4" onClick={goDashboard}>
              {user ? 'العودة إلى تصاميمك' : 'ابدأ التصميم'}
            </Button>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* ── Hero ── */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 bg-brand-gradient-soft" aria-hidden="true" />
          {/* aurora blobs — subtle, GPU-cheap */}
          <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full blur-3xl opacity-20 bg-[#7D2AE8] animate-float" aria-hidden="true" />
          <div className="absolute -bottom-40 -left-32 h-96 w-96 rounded-full blur-3xl opacity-20 bg-[#00C4CC] animate-float" style={{ animationDelay: '2s' }} aria-hidden="true" />
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 pt-16 pb-20 sm:pt-24 sm:pb-28 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs font-semibold text-[#7D2AE8] shadow-sm animate-fade-up">
              <Sparkles size={14} /> مجاني دائماً · لا يتطلب حساباً · ترخيص MIT · قابل للاستضافة الذاتية
            </div>
            <h1 className="mt-6 text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05] animate-fade-up delay-100">
              صمّم كل ما تتخيله.
              <br />
              <span className="text-brand-gradient">مجاني للجميع.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base sm:text-lg text-muted-foreground animate-fade-up delay-200">
              TEa.G3 منصة تصميم مفتوحة المصدر للمنشورات والعروض والملصقات والشعارات، مع تعاون مباشر وأدوات ذكاء اصطناعي تساعدك على الإبداع. صمّم واسحب وأفلت وصدّر من المتصفح وعلى أي جهاز.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-up delay-300">
              <Button size="lg" className="btn-brand-gradient rounded-full px-8 text-base h-12 gap-2" onClick={goDashboard}>
                ابدأ التصميم — it&apos;s free <ArrowRight size={18} />
              </Button>
              <a href="https://github.com/TEaG3/eng-salman" target="_blank" rel="noreferrer" className="w-full sm:w-auto">
                <Button size="lg" variant="outline" className="rounded-full px-8 text-base h-12 gap-2 w-full sm:w-auto">
                  <Github size={18} /> أضف نجمة للمشروع على GitHub
                </Button>
              </a>
            </div>
            {/* hero proof line */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground animate-fade-up delay-300">
              {['لا تحتاج إلى بطاقة مصرفية', 'دون علامات مائية', 'صدّر بثماني صيغ', 'يمكن تشغيله على خادمك'].map((t) => (
                <span key={t} className="inline-flex items-center gap-1.5">
                  <Check size={13} className="text-[#12A594]" /> {t}
                </span>
              ))}
            </div>
            <div className="mt-14 sm:mt-20 animate-fade-up delay-300">
              <EditorMockup />
            </div>
          </div>
        </section>

        {/* ── Stats strip ── */}
        <section className="border-y border-black/5 bg-[#FAFAFC]">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10 grid grid-cols-2 sm:grid-cols-5 gap-6 text-center">
            {[
              ['MIT', 'license'],
              ['369', 'fonts'],
              ['366', 'templates'],
              ['160+', 'stickers'],
              ['562+', 'icons'],
            ].map(([num, label]) => (
              <div key={label}>
                <div className="text-3xl sm:text-4xl font-extrabold text-brand-gradient">{num}</div>
                <div className="mt-1 text-sm text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Big differentiators: collab / AI / self-host ── */}
        <section id="collab" className="mx-auto max-w-7xl px-4 sm:px-6 py-20 sm:py-28">
          <div className="text-center">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              What the paid tools charge for,{' '}
              <span className="text-brand-gradient">TEa.G3 gives away</span>
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              The features that cost the most elsewhere — collaboration seats, AI credits, team
              workspaces — are core parts of TEa.G3, free and open.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 lg:grid-cols-3 gap-5">
            {BIG_FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-3xl border border-black/8 bg-white p-7 hover:shadow-xl hover:shadow-black/5 transition-all hover:-translate-y-1"
              >
                <div className={`h-12 w-12 rounded-2xl flex items-center justify-center text-white shadow-lg bg-gradient-to-br ${f.accent} group-hover:scale-105 transition-transform`}>
                  <f.icon size={22} />
                </div>
                <h3 className="mt-5 text-lg font-bold">{f.title}</h3>
                <p className="mt-2.5 text-sm text-muted-foreground leading-relaxed">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── المميزات grid ── */}
        <section id="features" className="bg-[#FAFAFC] border-y border-black/5">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 py-20 sm:py-28">
            <h2 className="text-center text-3xl sm:text-4xl font-extrabold tracking-tight">
              كل ما تحتاجه لـ <span className="text-brand-gradient">create</span>
            </h2>
            <p className="mt-4 text-center text-muted-foreground max-w-2xl mx-auto">
              A serious editor, not a toy. TEa.G3 packs the features people actually use from
              commercial design tools — minus the price tag.
            </p>
            <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {FEATURES.map((f) => (
                <div
                  key={f.title}
                  className="group rounded-2xl border border-black/8 bg-white p-6 hover:shadow-lg hover:shadow-black/5 hover:border-[#00C4CC]/40 transition-all"
                >
                  <div className="h-11 w-11 rounded-xl flex items-center justify-center bg-brand-gradient-soft text-[#7D2AE8] group-hover:scale-105 transition-transform">
                    <f.icon size={20} />
                  </div>
                  <h3 className="mt-4 font-bold">{f.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── القوالب ── */}
        <section id="templates" className="py-20 sm:py-28">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="text-center">
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
                Start from a <span className="text-brand-gradient">template</span>
              </h2>
              <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
                Sized and styled for every platform. Open one, tweak everything — every template is
                free, forever.
              </p>
            </div>
            <div className="mt-12 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {TEMPLATE_SHOWCASE.map((t) => (
                <button
                  key={t.label}
                  onClick={goDashboard}
                  className="group text-left"
                  aria-label={`Open ${t.label} templates`}
                >
                  <div
                    className="aspect-[4/5] rounded-xl overflow-hidden shadow-sm group-hover:shadow-xl group-hover:-translate-y-1 transition-all flex flex-col items-center justify-center gap-3 border border-black/5"
                    style={{ background: `linear-gradient(140deg, ${t.from}, ${t.to})` }}
                  >
                    <t.icon size={22} className={t.dark ? 'text-[#1F2226]' : 'text-white'} />
                    <div className={`text-sm font-extrabold tracking-wide ${t.dark ? 'text-[#1F2226]' : 'text-white'}`}>
                      {t.title}
                    </div>
                  </div>
                  <div className="mt-2 text-sm font-medium text-center group-hover:text-[#7D2AE8] transition-colors">
                    {t.label}
                  </div>
                </button>
              ))}
            </div>
            <div className="mt-10 text-center">
              <Button variant="outline" className="rounded-full px-6 gap-2" onClick={goDashboard}>
                تصفّح جميع القوالب الـ366 <ArrowRight size={16} />
              </Button>
            </div>
          </div>
        </section>

        {/* ── الأسئلة الشائعة (v0.26) ── */}
        <section id="faq" className="bg-[#FAFAFC] border-y border-black/5 py-20 sm:py-28">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <h2 className="text-center text-3xl sm:text-4xl font-extrabold tracking-tight">
              أسئلة <span className="text-brand-gradient">وأجوبة</span>
            </h2>
            <div className="mt-10 space-y-3">
              {الأسئلة الشائعة.map((f, i) => (
                <FaqItem key={f.q} q={f.q} a={f.a} defaultOpen={i === 0} />
              ))}
            </div>
          </div>
        </section>

        {/* ── مفتوح المصدر ── */}
        <section id="opensource" className="mx-auto max-w-7xl px-4 sm:px-6 py-20 sm:py-28">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-4 py-1.5 text-xs font-semibold text-[#7D2AE8] shadow-sm">
                <Star size={14} /> تطوير مفتوح المصدر
              </div>
              <h2 className="mt-5 text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight">
                أداة التصميم التي <span className="text-brand-gradient">تكون ملكك</span>
              </h2>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                Commercial design tools lock your creativity behind subscriptions. TEa.G3 is
                different — the code is on GitHub, the license is MIT, and every design you make
                is exportable at full quality. Self-host it, fork it, improve it.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <a href="https://github.com/TEaG3/eng-salman" target="_blank" rel="noreferrer">
                  <Button size="lg" className="btn-brand-gradient rounded-full px-8 gap-2 h-12 w-full sm:w-auto">
                    <Github size={18} /> عرض الشيفرة المصدرية
                  </Button>
                </a>
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-full px-8 h-12 w-full sm:w-auto"
                  onClick={goDashboard}
                >
                  جرّبه الآن
                </Button>
              </div>
            </div>
            {/* terminal framed like the editor mockup above — same window-chrome motif */}
            <div className="rounded-2xl border border-black/10 bg-white shadow-2xl shadow-violet-900/10 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-[#F4F5F7] border-b border-black/5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#FF5C8A]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#FFD166]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#34C77B]" />
                <span className="ml-2 text-xs font-medium text-muted-foreground">terminal — canvix</span>
              </div>
              <div className="font-mono text-xs sm:text-sm leading-relaxed bg-[#17181D] p-5 overflow-x-auto">
                <div className="text-white/40"># clone &amp; run your own Canva alternative</div>
                <div><span className="text-[#FF5C8A]">$</span> <span className="text-white/90">git clone https://github.com/TEaG3/eng-salman</span></div>
                <div><span className="text-[#FF5C8A]">$</span> <span className="text-white/90">cd canvix &amp;&amp; bun install</span></div>
                <div><span className="text-[#FF5C8A]">$</span> <span className="text-white/90">bun run db:push &amp;&amp; bun run db:seed</span></div>
                <div><span className="text-[#FF5C8A]">$</span> <span className="text-white/90">bun run dev</span></div>
                <div className="mt-3 text-[#34C77B]">✓ ready on http://localhost:3000</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Final CTA (v0.26) ── */}
        <section className="relative overflow-hidden border-t border-black/5">
          <div className="absolute inset-0 bg-brand-gradient-soft" aria-hidden="true" />
          <div className="relative mx-auto max-w-3xl px-4 sm:px-6 py-20 sm:py-24 text-center">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
              Your next design is <span className="text-brand-gradient">one click away</span>
            </h2>
            <p className="mt-4 text-muted-foreground">
              No signup, no credit card, no watermark. Open the editor and start creating right now.
            </p>
            <Button size="lg" className="btn-brand-gradient rounded-full px-10 text-base h-13 gap-2 mt-8 py-3.5" onClick={goDashboard}>
              ابدأ التصميم <ArrowRight size={18} />
            </Button>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="mt-auto border-t border-black/5 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <شعار size={24} />
            <span className="text-sm text-muted-foreground">
              © 2026 TEa.G3 · MIT License
            </span>
          </div>
          <div className="flex items-center gap-5 text-sm text-muted-foreground">
            <a href="https://github.com/TEaG3/eng-salman" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors inline-flex items-center gap-1.5">
              <Github size={15} /> GitHub
            </a>
            <a href="https://github.com/TEaG3/eng-salman#-ai--development-disclosure" target="_blank" rel="noreferrer" className="hover:text-foreground transition-colors">AI Disclosure</a>
            <a href="#features" className="hover:text-foreground transition-colors">المميزات</a>
            <a href="#faq" className="hover:text-foreground transition-colors">الأسئلة الشائعة</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
