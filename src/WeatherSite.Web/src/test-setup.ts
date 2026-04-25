import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class IntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [] as IntersectionObserverEntry[];
  }
  root = null;
  rootMargin = "";
  thresholds = [0];
}

vi.stubGlobal("ResizeObserver", ResizeObserver);
vi.stubGlobal("IntersectionObserver", IntersectionObserver);
vi.stubGlobal("matchMedia", (query: string) => ({
  addEventListener: vi.fn(),
  addListener: vi.fn(),
  dispatchEvent: vi.fn(),
  matches: false,
  media: query,
  onchange: null,
  removeEventListener: vi.fn(),
  removeListener: vi.fn()
}));

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn()
});

Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
  configurable: true,
  value() {
    return {
      bottom: 600,
      height: 600,
      left: 0,
      right: 800,
      toJSON() {
        return {};
      },
      top: 0,
      width: 800,
      x: 0,
      y: 0
    };
  }
});

afterEach(() => {
  cleanup();
});
