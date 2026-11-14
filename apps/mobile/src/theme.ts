import { Platform, type TextStyle } from "react-native";
export const colors = {
  bg: "#05070B",
  bgRaised: "#0A0E15",
  glass: "rgba(18,24,36,0.62)",
  glassStrong: "rgba(12,16,24,0.78)",
  line: "rgba(255,255,255,0.08)",
  lineStrong: "rgba(255,255,255,0.14)",
  highlight: "rgba(255,255,255,0.10)",
  text: "#EEF4FB",
  dim: "#93A0B4",
  mute: "#566076",
  accent: "#5CE1FF",
  accentDeep: "#2B8CFF",
  accentSoft: "rgba(92,225,255,0.12)",
  accentGlow: "rgba(92,225,255,0.35)",
  ok: "#3DDC97",
  warn: "#F5C15C",
  danger: "#FF6B81",
  claude: "#F2A26B",
  codex: "#7FA8FF",
  grok: "#DCE3EE",
  ollama: "#C7A6FF",
  grid: "rgba(92,225,255,0.06)",
  transparent: "transparent",
  buttonInk: "#04121A",
  input: "rgba(255,255,255,0.04)",
  tile: "rgba(255,255,255,0.03)",
  ghost: "rgba(255,255,255,0.05)",
  terminal: "rgba(0,0,0,0.35)",
  ink: "#EEF4FB",
  card: "#0A0E15",
};
export const gradients = {
  gradPrimary: [colors.accent, colors.accentDeep],
  gradBorder: [
    "rgba(92,225,255,0.85)",
    "rgba(43,140,255,0.25)",
    "rgba(92,225,255,0.05)",
  ],
  gradBorderIdle: ["rgba(255,255,255,0.16)", "rgba(255,255,255,0.03)"],
  gradAurora: [
    "rgba(92,225,255,0.16)",
    "rgba(43,140,255,0.06)",
    "rgba(5,7,11,0)",
  ],
  gradFade: ["rgba(5,7,11,0)", colors.bg],
  gradScan: [colors.transparent, colors.accentGlow, colors.transparent],
} as const;
const font = (
  fontSize: number,
  lineHeight: number,
  fontWeight: TextStyle["fontWeight"],
  letterSpacing = 0,
): TextStyle => ({ fontSize, lineHeight, fontWeight, letterSpacing });
export const type = {
  display: font(28, 34, "700", -0.5),
  title: font(20, 26, "700", -0.3),
  stat: {
    ...font(24, 28, "700", -0.4),
    fontVariant: ["tabular-nums"] as TextStyle["fontVariant"],
  },
  heading: font(16, 22, "600"),
  body: font(15, 22, "400"),
  small: font(13, 18, "400"),
  caption: font(11, 14, "500", 0.3),
  mono: {
    ...font(12, 17, "400"),
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
  },
};
export const space = [4, 8, 12, 16, 20, 24] as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 };
export const glow = {
  glowPrimary: {
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  glowCard: {
    shadowColor: colors.accent,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
  glowDot: {
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
};
export const theme = colors;
