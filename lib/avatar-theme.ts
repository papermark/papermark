const AVATAR_THEMES = [
  { bg: "#E0F2FE", fg: "#0284C7" },
  { bg: "#DBEAFE", fg: "#2563EB" },
  { bg: "#E0E7FF", fg: "#4F46E5" },
  { bg: "#EDE9FE", fg: "#7C3AED" },
  { bg: "#F3E8FF", fg: "#9333EA" },
  { bg: "#FCE7F3", fg: "#DB2777" },
  { bg: "#FFE4E6", fg: "#E11D48" },
  { bg: "#FEE2E2", fg: "#DC2626" },
  { bg: "#FFEDD5", fg: "#EA580C" },
  { bg: "#FEF3C7", fg: "#D97706" },
  { bg: "#FEF9C3", fg: "#CA8A04" },
  { bg: "#ECFCCB", fg: "#65A30D" },
  { bg: "#DCFCE7", fg: "#16A34A" },
  { bg: "#D1FAE5", fg: "#059669" },
  { bg: "#CCFBF1", fg: "#0D9488" },
  { bg: "#CFFAFE", fg: "#0891B2" },
] as const;

function avatarHashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

export function getAvatarTheme(
  seed?: string | null,
): (typeof AVATAR_THEMES)[number] {
  if (!seed) {
    return AVATAR_THEMES[Math.floor(Math.random() * AVATAR_THEMES.length)];
  }
  const index = avatarHashCode(seed) % AVATAR_THEMES.length;
  return AVATAR_THEMES[index];
}
