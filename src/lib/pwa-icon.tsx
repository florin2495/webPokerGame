import { ImageResponse } from "next/og";

// Opaque app icon: white spade on a green felt background.
// `inset` shrinks the artwork (maskable icons keep it inside the central 80%).
export function pwaIcon(px: number, inset = 1): ImageResponse {
  const s = px * inset;
  const spade = s * 0.58;
  return new ImageResponse(
    (
      <div
        style={{
          width: px,
          height: px,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#047857",
        }}
      >
        <svg width={spade} height={spade} viewBox="0 0 100 100">
          <path
            d="M50 4 C62 24 94 40 94 63 C94 79 82 87 70 87 C62 87 56 83 53 78 C54 88 58 94 66 98 L34 98 C42 94 46 88 47 78 C44 83 38 87 30 87 C18 87 6 79 6 63 C6 40 38 24 50 4 Z"
            fill="#fafaf9"
          />
        </svg>
      </div>
    ),
    { width: px, height: px },
  );
}
