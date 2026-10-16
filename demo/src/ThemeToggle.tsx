import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

export const THEME_KEY = 'dashboard-kit-demo:theme';
export const PREVIEW_KEY = 'dashboard-kit-demo:theme-preview-seen';
type Theme = 'light' | 'dark';
const SUN = 'M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm8,24a64,64,0,1,0,64,64A64.07,64.07,0,0,0,128,64ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z';
const MOON = 'M235.54,150.21a104.84,104.84,0,0,1-37,52.91A104,104,0,0,1,32,120,103.09,103.09,0,0,1,52.88,57.48a104.84,104.84,0,0,1,52.91-37,8,8,0,0,1,10,10,88.08,88.08,0,0,0,109.8,109.8,8,8,0,0,1,10,10Z';

function read(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Keep working for this visit. */ }
}
function preferredTheme(): Theme {
  const saved = read(THEME_KEY);
  return saved === 'light' || saved === 'dark' ? saved
    : matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
export function initializeDemoTheme() {
  const theme = preferredTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f7f8fc' : '#13141d');
  return theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(preferredTheme);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = button.current!;
    const html = document.documentElement;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const system = matchMedia('(prefers-color-scheme: light)');
    let current = preferredTheme();
    let preference = current;
    let explicitPreference = read(THEME_KEY) === 'light' || read(THEME_KEY) === 'dark';
    let sequence = 0;
    let previewTimer: number | undefined;
    let restoreTimer: number | undefined;
    let transition: ViewTransition | undefined;
    let animation: Animation | undefined;

    function apply(next: Theme) {
      current = next;
      html.dataset.theme = next;
      html.style.colorScheme = next;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#f7f8fc' : '#13141d');
      flushSync(() => setTheme(next));
    }
    function canAnimate() {
      return !reducedMotion.matches && typeof document.startViewTransition === 'function';
    }
    function cancel() {
      sequence++;
      window.clearTimeout(previewTimer);
      window.clearTimeout(restoreTimer);
      transition?.skipTransition();
      animation?.cancel();
      html.classList.remove('theme-vt-circle');
    }
    async function reveal(next: Theme, run: number) {
      if (run !== sequence) return;
      if (!canAnimate()) { apply(next); return; }
      html.classList.add('theme-vt-circle');
      const rect = element.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const origin = `${x / vw * 100}% ${y / vh * 100}%`;
      const radius = Math.hypot(Math.max(x, vw - x), Math.max(y, vh - y)) / (Math.hypot(vw, vh) / Math.SQRT2) * 100;
      try {
        const active = document.startViewTransition(() => { if (run === sequence) apply(next); });
        transition = active;
        // Skipped transitions can reject ready independently of finished.
        void active.finished.catch(() => {});
        void active.updateCallbackDone.catch(() => {});
        await active.ready;
        if (run !== sequence) return;
        // Match the dashboard's brief pause near the button, then expand.
        animation = html.animate([
          { clipPath: `circle(0% at ${origin})` },
          { clipPath: `circle(4% at ${origin})`, offset: 0.12 },
          { clipPath: `circle(5% at ${origin})`, offset: 0.4 },
          { clipPath: `circle(${radius}% at ${origin})` },
        ], { duration: 1400, easing: 'cubic-bezier(0.33, 0.05, 0.25, 1)', pseudoElement: '::view-transition-new(root)' });
        await active.finished;
      } catch {
        if (run === sequence) { transition?.skipTransition(); apply(next); }
      } finally {
        if (run === sequence) {
          transition = undefined;
          animation = undefined;
          html.classList.remove('theme-vt-circle');
        }
      }
    }
    function toggle() {
      const next = current === 'dark' ? 'light' : 'dark';
      cancel();
      preference = next;
      explicitPreference = true;
      store(THEME_KEY, next);
      store(PREVIEW_KEY, '1');
      void reveal(next, sequence);
    }
    function updateSystem() {
      if (explicitPreference) return;
      cancel();
      preference = system.matches ? 'light' : 'dark';
      apply(preference);
    }
    function updateMotion() {
      if (reducedMotion.matches) { cancel(); apply(preference); }
      else schedulePreview();
    }
    function stopHiddenPreview() {
      if (document.hidden) { cancel(); apply(preference); }
      else schedulePreview();
    }

    element.addEventListener('click', toggle);
    system.addEventListener('change', updateSystem);
    reducedMotion.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', stopHiddenPreview);
    function schedulePreview() {
      window.clearTimeout(previewTimer);
      if (read(PREVIEW_KEY) || document.hidden || !canAnimate()) return;
      previewTimer = window.setTimeout(async () => {
        if (document.hidden || document.querySelector('dialog[open]') || !canAnimate()) return;
        store(PREVIEW_KEY, '1');
        const run = ++sequence;
        await reveal(preference === 'dark' ? 'light' : 'dark', run);
        if (run !== sequence) return;
        restoreTimer = window.setTimeout(() => { void reveal(preference, run); }, 400);
      }, 1000);
    }
    schedulePreview();
    return () => {
      cancel();
      html.dataset.theme = preference;
      html.style.colorScheme = preference;
      element.removeEventListener('click', toggle);
      system.removeEventListener('change', updateSystem);
      reducedMotion.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', stopHiddenPreview);
    };
  }, []);

  const next = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} theme`;
  return <button ref={button} type="button" className="card-nav-theme" aria-label={label} title={label}>
    <svg key={next} className={`card-nav-theme-icon card-nav-theme-icon--${next === 'light' ? 'sun' : 'moon'}`}
      viewBox="0 0 256 256" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d={next === 'light' ? SUN : MOON} />
    </svg>
  </button>;
}
