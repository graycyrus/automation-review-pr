// Tiny classname combiner — falsy values are dropped.
export function clsx(...parts: Array<string | undefined | null | false>): string {
  return parts.filter(Boolean).join(' ');
}
