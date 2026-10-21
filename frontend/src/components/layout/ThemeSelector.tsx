"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Sáng", Icon: Sun },
  { value: "dark", label: "Tối", Icon: Moon },
  { value: "system", label: "Theo hệ thống", Icon: Monitor },
] as const;

export function ThemeSelector({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Mount Radix after hydration: streamed pages can assign different menu IDs.
  const trigger = (
    <button
      type="button"
      aria-label="Giao diện"
      title="Đổi giao diện"
      disabled={!mounted}
      className={cn(
        "flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 data-[state=open]:bg-surface-muted",
        className,
      )}
    >
      <SunMoon className="h-5 w-5 shrink-0" aria-hidden />
      <span className="hidden sm:inline">Giao diện</span>
    </button>
  );

  if (!mounted) return trigger;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-[100] min-w-[208px] rounded-2xl border border-border bg-surface-elevated p-1.5 text-ink shadow-xl"
        >
          <DropdownMenu.Label className="px-3 py-2 text-xs font-semibold text-ink-muted">
            Giao diện
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={theme ?? "system"} onValueChange={setTheme}>
            {OPTIONS.map(({ value, label, Icon }) => (
              <DropdownMenu.RadioItem
                key={value}
                value={value}
                className="relative flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-xl py-2 pl-3 pr-10 text-sm outline-none data-[highlighted]:bg-surface-muted data-[state=checked]:text-brand-600 dark:data-[state=checked]:text-brand-400"
              >
                <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
                {label}
                <DropdownMenu.ItemIndicator className="absolute right-3">
                  <Check className="h-4 w-4" aria-hidden />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
