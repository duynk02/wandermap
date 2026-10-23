/** Browser hints trigger checks, never assert that the backend is reachable. */
export function observeBrowserResume(resume: () => void, offline: () => void) {
  let lastCheck = -Infinity;
  const check = () => {
    if (document.visibilityState !== "visible" || Date.now() - lastCheck < 15_000) return;
    lastCheck = Date.now();
    resume();
  };
  window.addEventListener("online", check);
  window.addEventListener("offline", offline);
  document.addEventListener("visibilitychange", check);
  return () => {
    window.removeEventListener("online", check);
    window.removeEventListener("offline", offline);
    document.removeEventListener("visibilitychange", check);
  };
}
