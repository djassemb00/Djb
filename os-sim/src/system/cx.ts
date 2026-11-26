/** Tiny class-name joiner (avoids pulling in a dependency for 20 bytes of logic). */
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}
