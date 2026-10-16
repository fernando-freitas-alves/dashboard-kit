import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { initializeDemoTheme, ThemeToggle, THEME_KEY, PREVIEW_KEY } from '../demo/src/ThemeToggle';

async function setup({ reduced = false, supported = true, saved, seen = false, broken = false }: {
  reduced?: boolean; supported?: boolean; saved?: string; seen?: boolean; broken?: boolean;
} = {}) {
  const dom = new JSDOM('<html><head><meta name="theme-color" /></head><body><div id="app"></div></body></html>', {
    url: 'http://localhost', pretendToBeVisual: true,
  });
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'localStorage']) {
    Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
  }
  const system = Object.assign(new dom.window.EventTarget(), { matches: true });
  const motion = Object.assign(new dom.window.EventTarget(), { matches: reduced });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, matchMedia: (query: string) => query.includes('reduced') ? motion : system });
  if (saved) localStorage.setItem(THEME_KEY, saved);
  if (seen) localStorage.setItem(PREVIEW_KEY, '1');
  let id = 0;
  const timers = new Map<number, () => void>();
  dom.window.setTimeout = ((fn: () => void) => { timers.set(++id, fn); return id; }) as any;
  dom.window.clearTimeout = (key: number) => { timers.delete(key); };
  const themes: string[] = [];
  const animations: { frames: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
  let skipped = 0;
  if (supported) {
    document.startViewTransition = ((update: () => void) => {
      const updated = Promise.resolve().then(() => { update(); themes.push(document.documentElement.dataset.theme!); });
      return { ready: broken ? Promise.reject(Error('Transition unavailable')) : updated,
        finished: updated, updateCallbackDone: updated, skipTransition() { skipped++; } };
    }) as any;
  }
  document.documentElement.animate = ((frames: Keyframe[], options: KeyframeAnimationOptions) => {
    animations.push({ frames, options });
    return { cancel() {} };
  }) as any;
  initializeDemoTheme();
  const root = createRoot(document.getElementById('app')!);
  await act(() => root.render(<ThemeToggle />));
  const button = document.querySelector('button')!;
  return { dom, button, system, motion, timers, themes, animations,
    skipped: () => skipped,
    click: () => act(async () => { button.click(); await Promise.resolve(); }),
    tick: () => act(async () => {
      const entry = timers.entries().next().value;
      assert.ok(entry, 'Expected a pending preview timer');
      timers.delete(entry[0]);
      await entry[1]();
    }),
    close: async () => { await act(() => root.unmount()); dom.window.close(); },
  };
}

test('first visit previews both themes, restores the preference, and does not replay on later visits', async () => {
  const ui = await setup({ saved: 'dark' });
  try {
    assert.equal(ui.button.getAttribute('aria-label'), 'Switch to light theme');
    assert.ok(ui.button.querySelector('.card-nav-theme-icon--sun'));
    await ui.tick();
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(localStorage.getItem(THEME_KEY), 'dark');
    assert.equal(localStorage.getItem(PREVIEW_KEY), '1');
    await ui.tick();
    assert.equal(document.documentElement.dataset.theme, 'dark');
    assert.deepEqual(ui.themes, ['light', 'dark']);
    assert.equal(ui.animations[0].options.pseudoElement, '::view-transition-new(root)');
    assert.equal(ui.animations[0].options.duration, 1400);
    assert.ok(String(ui.animations[0].frames[0].clipPath).startsWith('circle(0%'));
    assert.equal(document.documentElement.classList.contains('theme-vt-circle'), false);
  } finally { await ui.close(); }
  const returning = await setup({ saved: 'dark', seen: true });
  try { assert.equal(returning.timers.size, 0); } finally { await returning.close(); }
});

test('manual toggle saves the preference, updates the icon, and cancels the first-visit preview', async () => {
  const ui = await setup();
  try {
    assert.ok(ui.button.querySelector('.card-nav-theme-icon--moon'));
    await ui.click();
    assert.equal(document.documentElement.dataset.theme, 'dark');
    assert.equal(document.querySelector('meta[name="theme-color"]')?.getAttribute('content'), '#13141d');
    assert.equal(localStorage.getItem(THEME_KEY), 'dark');
    assert.equal(ui.button.getAttribute('aria-label'), 'Switch to light theme');
    assert.equal(ui.timers.size, 0);
    await ui.click();
    assert.equal(localStorage.getItem(THEME_KEY), 'light');
    assert.equal(ui.animations.length, 2);
  } finally { await ui.close(); }
});

test('clicking during the preview cancels its return trip and preserves the user selection', async () => {
  const ui = await setup();
  try {
    await ui.tick();
    assert.equal(document.documentElement.dataset.theme, 'dark');
    await ui.click();
    assert.equal(ui.timers.size, 0);
    assert.equal(localStorage.getItem(THEME_KEY), 'light');
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.deepEqual(ui.themes, ['dark', 'light']);
  } finally { await ui.close(); }
});

for (const options of [{ reduced: true }, { supported: false }, { broken: true }]) {
  test(`theme toggle still works with ${JSON.stringify(options)}`, async () => {
    const ui = await setup(options);
    try {
      if (!options.broken) assert.equal(ui.timers.size, 0);
      await ui.click();
      assert.equal(document.documentElement.dataset.theme, 'dark');
      assert.equal(ui.animations.length, 0);
      assert.equal(document.documentElement.classList.contains('theme-vt-circle'), false);
      if (options.broken) assert.ok(ui.skipped());
    } finally { await ui.close(); }
  });
}

test('system preference changes apply until the user chooses a theme; cleanup removes timers and listeners', async () => {
  const ui = await setup();
  try {
    await act(() => {
      ui.system.matches = false;
      ui.system.dispatchEvent(new ui.dom.window.Event('change'));
    });
    assert.equal(document.documentElement.dataset.theme, 'dark');
    assert.equal(localStorage.getItem(THEME_KEY), null);
    await ui.click();
    assert.equal(document.documentElement.dataset.theme, 'light');
    await act(() => ui.system.dispatchEvent(new ui.dom.window.Event('change')));
    assert.equal(document.documentElement.dataset.theme, 'light');
  } finally { await ui.close(); }
  assert.equal(ui.timers.size, 0);
});

test('switching to reduced motion during the preview restores the preference', async () => {
  const ui = await setup();
  try {
    await ui.tick();
    await act(() => {
      ui.motion.matches = true;
      ui.motion.dispatchEvent(new ui.dom.window.Event('change'));
    });
    assert.equal(document.documentElement.dataset.theme, 'light');
    assert.equal(ui.timers.size, 0);
  } finally { await ui.close(); }
});


test('a first visit opened in the background previews when the page becomes visible', async () => {
  const ui = await setup();
  try {
    await act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new ui.dom.window.Event('visibilitychange'));
    });
    assert.equal(ui.timers.size, 0);
    assert.equal(localStorage.getItem(PREVIEW_KEY), null);
    await act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new ui.dom.window.Event('visibilitychange'));
    });
    await ui.tick();
    await ui.tick();
    assert.deepEqual(ui.themes, ['dark', 'light']);
  } finally { await ui.close(); }
});
