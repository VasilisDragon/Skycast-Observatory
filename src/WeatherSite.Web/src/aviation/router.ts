import { createContext, useContext, useEffect, useState } from "react";

export type AviationRoute =
  | { kind: "index" }
  | { kind: "airport"; icao: string }
  | { kind: "route"; dep: string | null; dest: string | null }
  | { kind: "unknown" };

export function parseRoute(pathname: string, search: string): AviationRoute | null {
  if (!pathname.startsWith("/aviation")) {
    return null;
  }
  const segments = pathname.replace(/^\/aviation\/?/, "").split("/").filter(Boolean);
  if (segments.length === 0) {
    return { kind: "index" };
  }
  const [first, ...rest] = segments;
  if (first === "route") {
    const params = new URLSearchParams(search);
    return { kind: "route", dep: params.get("dep"), dest: params.get("dest") };
  }
  if (/^[KP][A-Z0-9]{3}$/i.test(first) && rest.length === 0) {
    return { kind: "airport", icao: first.toUpperCase() };
  }
  return { kind: "unknown" };
}

export function buildAviationPath(route: AviationRoute): string {
  switch (route.kind) {
    case "index":
      return "/aviation";
    case "airport":
      return `/aviation/${route.icao.toUpperCase()}`;
    case "route": {
      const params = new URLSearchParams();
      if (route.dep) params.set("dep", route.dep);
      if (route.dest) params.set("dest", route.dest);
      const query = params.toString();
      return query ? `/aviation/route?${query}` : "/aviation/route";
    }
    default:
      return "/aviation";
  }
}

type RouterContextValue = {
  route: AviationRoute;
  navigate: (to: AviationRoute, options?: { replace?: boolean }) => void;
};

const RouterContext = createContext<RouterContextValue | null>(null);

export function useAviationRouter(): RouterContextValue {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error("useAviationRouter must be used inside an AviationRouterProvider.");
  }
  return ctx;
}

export function useAviationRouterState(): RouterContextValue {
  const [route, setRoute] = useState<AviationRoute>(
    () => parseRoute(window.location.pathname, window.location.search) ?? { kind: "index" }
  );

  useEffect(() => {
    const onPop = () => {
      const next = parseRoute(window.location.pathname, window.location.search);
      if (next) {
        setRoute(next);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = (to: AviationRoute, options?: { replace?: boolean }) => {
    const path = buildAviationPath(to);
    if (options?.replace) {
      window.history.replaceState({}, "", path);
    } else {
      window.history.pushState({}, "", path);
    }
    setRoute(to);
  };

  return { route, navigate };
}

export const AviationRouterProvider = RouterContext.Provider;

export function isAviationPath(pathname: string): boolean {
  return pathname === "/aviation" || pathname.startsWith("/aviation/");
}
