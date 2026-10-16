import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act, useEffect, useState } from 'react';
import { LayoutPreview } from '../demo/src/LayoutPreview';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent']) {
  Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
}
const { createRoot } = await import('react-dom/client');
let width = 390;
let measure = () => {};
let disconnected = false;
Object.defineProperty(dom.window.HTMLElement.prototype, 'clientWidth', { get: () => width });
Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class {
    constructor(callback: () => void) { measure = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  },
});

test('layout preview preserves the mounted board and edits across entering, exiting, and viewport changes', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let mounts = 0;
  function Board() {
    const [size, setSize] = useState(4);
    useEffect(() => { mounts++; }, []);
    return <button data-board onClick={() => setSize(size + 2)}>Height {size}</button>;
  }
  try {
    await act(() => root.render(<LayoutPreview><Board /></LayoutPreview>));
    const toggle = host.querySelector('.layout-preview-controls button') as HTMLButtonElement;
    const board = host.querySelector('[data-board]') as HTMLButtonElement;
    const viewport = host.querySelector('.layout-preview-viewport') as HTMLDivElement;
    assert.equal(toggle.textContent, 'Try layout editing');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(toggle.getAttribute('aria-controls'), viewport.id);

    await act(() => toggle.click());
    assert.equal(toggle.textContent, 'Done');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(viewport.getAttribute('role'), 'region');
    await act(() => board.click());
    viewport.scrollLeft = 600;
    viewport.scrollTop = 120;
    await act(() => toggle.click());
    assert.equal(viewport.scrollLeft, 0);
    assert.equal(viewport.scrollTop, 0);
    assert.equal(document.activeElement, toggle);
    assert.equal(host.querySelector('[data-board]'), board);
    assert.equal(board.textContent, 'Height 6');

    await act(() => toggle.click());
    await act(() => viewport.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(toggle.textContent, 'Try layout editing');
    assert.equal(mounts, 1);

    await act(() => { width = 1200; measure(); });
    assert.equal(host.querySelector('.layout-preview-controls'), null);
    assert.equal(host.querySelector('[data-board]'), board);
    await act(() => { width = 390; measure(); });
    assert.equal(host.querySelector('.layout-preview-controls button')?.textContent, 'Try layout editing');
    assert.equal(board.textContent, 'Height 6');
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
  assert.equal(disconnected, true);
});

test('Escape in a chart dialog does not also close layout editing', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(() => root.render(<LayoutPreview><dialog open><input /></dialog></LayoutPreview>));
    const toggle = host.querySelector('.layout-preview-controls button') as HTMLButtonElement;
    await act(() => toggle.click());
    await act(() => host.querySelector('input')!.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(toggle.textContent, 'Done');
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});
