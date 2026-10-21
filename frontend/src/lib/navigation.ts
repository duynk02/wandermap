const HISTORY_KEY = "wandermapNavigation";

interface NavigationEntry {
  pathname: string;
  canGoBack: boolean;
}

function entryFromState(
  state: Record<string, unknown>,
): NavigationEntry | undefined {
  const entry = state[HISTORY_KEY];
  if (!entry || typeof entry !== "object") return;
  const value = entry as Record<string, unknown>;
  if (
    typeof value.pathname === "string" &&
    typeof value.canGoBack === "boolean"
  ) {
    return { pathname: value.pathname, canGoBack: value.canGoBack };
  }
}

function historyState(): Record<string, unknown> {
  const state: unknown = window.history.state;
  return state && typeof state === "object"
    ? (state as Record<string, unknown>)
    : {};
}

/** Track push vs replace so redirects never invent a previous app page. */
export function trackNavigationHistory() {
  const pathname = window.location.pathname;
  const existing = entryFromState(historyState());
  let canGoBack = existing?.pathname === pathname ? existing.canGoBack : false;
  if (!existing && document.referrer) {
    try {
      const referrer = new URL(document.referrer);
      canGoBack =
        referrer.origin === window.location.origin &&
        referrer.href !== window.location.href;
    } catch {
      /* Treat an invalid/missing referrer as a direct visit. */
    }
  }
  const originalPush = window.history.pushState;
  const originalReplace = window.history.replaceState;
  const withEntry = (
    state: unknown,
    url: string | URL | null | undefined,
    previous: boolean,
  ) => ({
    ...(state && typeof state === "object" ? state : {}),
    [HISTORY_KEY]: {
      pathname: new URL(url ?? window.location.href, window.location.href)
        .pathname,
      canGoBack: previous,
    },
  });
  originalReplace.call(
    window.history,
    withEntry(historyState(), null, canGoBack),
    "",
  );
  const push: History["pushState"] = (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) => {
    const current = entryFromState(historyState());
    originalPush.call(
      window.history,
      withEntry(data, url, current?.pathname === window.location.pathname),
      unused,
      url,
    );
  };
  const replace: History["replaceState"] = (
    data: unknown,
    unused: string,
    url?: string | URL | null,
  ) => {
    originalReplace.call(
      window.history,
      withEntry(data, url, entryFromState(historyState())?.canGoBack ?? false),
      unused,
      url,
    );
  };
  window.history.pushState = push;
  window.history.replaceState = replace;
  return () => {
    if (window.history.pushState === push)
      window.history.pushState = originalPush;
    if (window.history.replaceState === replace)
      window.history.replaceState = originalReplace;
  };
}

export function canGoBackWithinApp() {
  const entry = entryFromState(historyState());
  return (
    window.history.length > 1 &&
    entry?.pathname === window.location.pathname &&
    entry.canGoBack
  );
}
