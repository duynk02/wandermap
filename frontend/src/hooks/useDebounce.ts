import { useCallback, useRef } from "react";

// Returns a debounced version of the callback
export function useDebounce<Args extends unknown[]>(
  fn: (...args: Args) => unknown,
  delay: number
): (...args: Args) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(
    (...args: Args) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => fn(...args), delay);
    },
    [fn, delay]
  );
}
