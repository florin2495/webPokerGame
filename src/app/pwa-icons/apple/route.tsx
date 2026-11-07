import { pwaIcon } from "@/lib/pwa-icon";

// Was src/app/apple-icon.tsx: with basePath, Turbopack emitted its <link> without the
// "/poker" prefix, so it is a plain route linked from layout metadata instead.
export function GET() {
  return pwaIcon(180);
}
