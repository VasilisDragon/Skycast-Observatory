import { useEffect, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// Mount a React subtree as the body of a MapLibre Popup. We do NOT use a React
// portal — the popup DOM is owned by MapLibre, and we render into it with a
// fresh React root. That keeps focus + dismissal a property of the DOM tree
// MapLibre is showing, not a side-channel of the parent React tree.
//
// Focus contract:
//   - On open: focus moves to the first tabbable element inside the popup
//     (or the popup container if there are none).
//   - Esc: closes the popup.
//   - Tab/Shift-Tab: trapped within the popup until Esc.
//   - On close: focus returns to the previously-focused element if still in
//     the document; otherwise the map canvas (so keyboard navigation continues).

export interface PopupHandle {
  remove(): void;
}

export interface PopupHost {
  // The MapLibre map instance — we keep this typed loosely so popup-mount stays
  // independent of whatever maplibre-gl import shape the caller uses.
  getCanvas(): HTMLElement;
}

export interface MountedPopupController {
  popup: { remove(): void; on(event: "close", handler: () => void): void };
  unmount: () => void;
}

export interface MountPopupArgs<TProps extends Record<string, unknown>> {
  // Constructor for `new maplibregl.Popup(...)` — passed in so we don't import
  // maplibre-gl from this module (keeps tree-shaking sane and lets the caller
  // own the map runtime version).
  createPopup(): {
    setLngLat(coords: [number, number]): { setDOMContent(node: HTMLElement): { addTo(map: unknown): { remove(): void; on(event: "close", handler: () => void): void } } };
  };
  map: PopupHost;
  lngLat: [number, number];
  render: (props: TProps & { onClose: () => void }) => ReactNode;
  initialProps: TProps;
}

export function mountAviationPopup<TProps extends Record<string, unknown>>({
  createPopup,
  map,
  lngLat,
  render,
  initialProps
}: MountPopupArgs<TProps>): MountedPopupController {
  const container = document.createElement("div");
  container.className = "obs-aviation-popup-host";
  const root: Root = createRoot(container);

  const popup = createPopup().setLngLat(lngLat).setDOMContent(container).addTo(map);

  const handleClose = () => popup.remove();

  root.render(
    <PopupShell onEscape={handleClose}>
      {render({ ...initialProps, onClose: handleClose })}
    </PopupShell>
  );

  popup.on("close", () => {
    // Defer unmount to next microtask so React isn't asked to update during
    // its own commit phase if the close was triggered from inside the tree.
    queueMicrotask(() => root.unmount());
    // Restore focus to the map canvas so keyboard interaction continues.
    try {
      map.getCanvas().focus();
    } catch {
      /* canvas may already be detached */
    }
  });

  return {
    popup,
    unmount: () => {
      popup.remove();
    }
  };
}

function PopupShell({ children, onEscape }: { children: ReactNode; onEscape: () => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    previouslyFocusedRef.current =
      typeof document !== "undefined"
        ? (document.activeElement as HTMLElement | null)
        : null;

    const focusables = collectTabbables(node);
    if (focusables.length > 0) {
      focusables[0].focus();
    } else {
      node.focus();
    }

    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;

      const live = collectTabbables(node);
      if (live.length === 0) {
        event.preventDefault();
        return;
      }
      const first = live[0];
      const last = live[live.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey && (active === first || !node.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !node.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      const previously = previouslyFocusedRef.current;
      if (previously && document.body.contains(previously)) {
        previously.focus();
      }
    };
  }, [onEscape]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      className="obs-aviation-popup-shell"
    >
      {children}
    </div>
  );
}

function collectTabbables(root: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute("aria-hidden") && el.offsetParent !== null
  );
}
