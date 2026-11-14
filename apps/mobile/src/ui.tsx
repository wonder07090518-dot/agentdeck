import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  StyleSheet,
  type TextInputProps,
  type ViewStyle,
  type StyleProp,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import type { AgentInfo, Machine } from "@agentdeck/protocol";
import { colors, gradients, type, glow } from "./theme";
import { quotaView, type AgentId } from "./presentation";
export { colors } from "./theme";
const pulse = new Animated.Value(0);
let users = 0;
let pulseLoop: Animated.CompositeAnimation | undefined;
export function useMotion() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (alive) setEnabled(!reduced);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (reduced) => setEnabled(!reduced),
    );
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return enabled;
}
export function Pulse({
  online = true,
  animate = true,
  color = colors.ok,
}: {
  online?: boolean;
  animate?: boolean;
  color?: string;
}) {
  const motion = useMotion(),
    active = online && animate && motion;
  useEffect(() => {
    if (!active) return;
    users++;
    if (!pulseLoop) {
      pulseLoop = Animated.loop(
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1800,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      );
      pulseLoop.start();
    }
    return () => {
      if (--users === 0) {
        pulseLoop?.stop();
        pulseLoop = undefined;
        pulse.setValue(0);
      }
    };
  }, [active]);
  return (
    <View
      style={{
        width: 12,
        height: 12,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {active && (
        <Animated.View
          style={{
            position: "absolute",
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: color,
            opacity: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [0.6, 0],
            }),
            transform: [
              {
                scale: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 2.6],
                }),
              },
            ],
          }}
        />
      )}
      <View
        style={[
          {
            width: 6,
            height: 6,
            borderRadius: 3,
            borderWidth: 1,
            borderColor: online ? color : colors.mute,
            backgroundColor: online ? color : colors.bg,
          },
          online && animate && { ...glow.glowDot, shadowColor: color },
        ]}
      />
    </View>
  );
}
export function Backdrop({ stream = false }: { stream?: boolean }) {
  const motion = useMotion(),
    aurora = useRef(new Animated.Value(0.6)).current,
    scan = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!motion || stream) return;
    const a = Animated.loop(
        Animated.sequence([
          Animated.timing(aurora, {
            toValue: 1,
            duration: 6000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(aurora, {
            toValue: 0.6,
            duration: 6000,
            useNativeDriver: true,
          }),
        ]),
      ),
      s = Animated.loop(
        Animated.timing(scan, {
          toValue: 1,
          duration: 9000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );
    a.start();
    s.start();
    return () => {
      a.stop();
      s.stop();
    };
  }, [motion, stream]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={{
          position: "absolute",
          top: 0,
          width: "100%",
          height: 360,
          opacity: stream ? 0.5 : aurora,
        }}
      >
        <LinearGradient colors={gradients.gradAurora} style={{ flex: 1 }} />
      </Animated.View>
      {Array.from({ length: 17 }, (_, i) => (
        <View
          key={i}
          style={{
            position: "absolute",
            backgroundColor: colors.grid,
            ...(i < 8
              ? {
                  left: 24 + i * 48,
                  top: 0,
                  width: StyleSheet.hairlineWidth,
                  height: 420,
                }
              : {
                  left: 0,
                  top: (i - 8) * 48,
                  width: "100%",
                  height: StyleSheet.hairlineWidth,
                }),
          }}
        />
      ))}
      <LinearGradient
        colors={gradients.gradFade}
        style={{ position: "absolute", top: 260, height: 160, width: "100%" }}
      />
      {!stream && (
        <Animated.View
          style={{
            position: "absolute",
            width: "100%",
            height: 1,
            opacity: scan.interpolate({
              inputRange: [0, 0.95, 1],
              outputRange: [0.6, 0.6, 0],
            }),
            transform: [
              {
                translateY: scan.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, 420],
                }),
              },
            ],
          }}
        >
          <LinearGradient
            colors={gradients.gradScan}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      )}
    </View>
  );
}
type CardProps = { children: React.ReactNode; style?: StyleProp<ViewStyle> };
export function GlassCard({
  children,
  style,
  gradient = false,
}: CardProps & { gradient?: boolean }) {
  if (gradient)
    return (
      <LinearGradient
        colors={gradients.gradBorderIdle}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[{ borderRadius: 16, padding: 1 }, style]}
      >
        <View
          style={{
            position: "absolute",
            top: 1,
            bottom: 1,
            left: 1,
            right: 1,
            borderRadius: 15,
            padding: 11,
            gap: 8,
            backgroundColor: colors.bgRaised,
          }}
        >
          {children}
        </View>
      </LinearGradient>
    );
  return (
    <View style={[styles.card, style]}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          left: 16,
          right: 16,
          height: 1,
          backgroundColor: colors.highlight,
        }}
      />
      {children}
    </View>
  );
}
export function BlurDock({ children, style }: CardProps) {
  return (
    <View
      style={[
        {
          overflow: "hidden",
          borderRadius: 22,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.line,
          backgroundColor: colors.glassStrong,
        },
        style,
      ]}
    >
      {Platform.OS !== "android" && (
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      )}
      <View
        style={{
          backgroundColor: colors.glassStrong,
          padding: 8,
          gap: 8,
          borderTopWidth: 1,
          borderTopColor: colors.highlight,
        }}
      >
        {children}
      </View>
    </View>
  );
}
export function GradientCard({
  children,
  style,
  compact = false,
  corner = 22,
  contentStyle,
}: CardProps & {
  compact?: boolean;
  corner?: number;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <LinearGradient
      colors={gradients.gradBorder}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[{ padding: 1, borderRadius: corner }, style]}
    >
      <View
        style={[
          {
            backgroundColor: colors.bgRaised,
            borderRadius: corner - 1,
            padding: 12,
            gap: compact ? 6 : 8,
          },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </LinearGradient>
  );
}
type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  small?: boolean;
  danger?: boolean;
  onLongPress?: () => void;
};
function BusyDots() {
  const motion = useMotion(),
    phase = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!motion) return;
    const loop = Animated.loop(
      Animated.timing(phase, {
        toValue: 3,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [motion]);
  return (
    <View accessibilityElementsHidden style={{ flexDirection: "row", gap: 4 }}>
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={{
            width: 4,
            height: 4,
            borderRadius: 2,
            backgroundColor: colors.dim,
            opacity: phase.interpolate({
              inputRange: [0, 1, 2, 3],
              outputRange: [
                i === 0 ? 1 : 0.25,
                i === 1 ? 1 : 0.25,
                i === 2 ? 1 : 0.25,
                i === 0 ? 1 : 0.25,
              ],
            }),
          }}
        />
      ))}
    </View>
  );
}
export function PrimaryButton({
  label,
  onPress,
  disabled,
  busy,
  small,
}: ButtonProps) {
  const scale = useRef(new Animated.Value(1)).current,
    motion = useMotion(),
    breath = useRef(new Animated.Value(0.2)).current;
  useEffect(() => {
    if (disabled || small || !motion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 0.6,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0.2,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [disabled, small, motion]);
  const content = (
    <View style={styles.row}>
      {busy && <BusyDots />}
      <Text
        style={{
          color: disabled ? colors.mute : colors.buttonInk,
          fontSize: 16,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </View>
  );
  return (
    <View style={{ position: "relative" }}>
      {!disabled && !small && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: colors.accentGlow,
              borderRadius: 14,
              opacity: breath,
              top: -3,
              bottom: -3,
              left: -3,
              right: -3,
            },
          ]}
        />
      )}
      <View
        style={[
          { backgroundColor: colors.bgRaised, borderRadius: 14 },
          !disabled && glow.glowPrimary,
        ]}
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled, busy }}
            disabled={disabled}
            onPress={onPress}
            onPressIn={() =>
              Animated.spring(scale, {
                toValue: 0.97,
                speed: 40,
                bounciness: 0,
                useNativeDriver: true,
              }).start()
            }
            onPressOut={() =>
              Animated.spring(scale, {
                toValue: 1,
                speed: 40,
                bounciness: 0,
                useNativeDriver: true,
              }).start()
            }
          >
            {disabled ? (
              <View
                style={{
                  height: small ? 44 : 52,
                  backgroundColor: colors.accentSoft,
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {content}
              </View>
            ) : (
              <LinearGradient
                colors={gradients.gradPrimary}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  height: small ? 44 : 52,
                  borderRadius: 14,
                  paddingHorizontal: 16,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {content}
              </LinearGradient>
            )}
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}
export function GhostButton({
  label,
  onPress,
  disabled,
  danger,
  onLongPress,
}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[
        styles.button,
        { borderColor: danger ? colors.danger : colors.lineStrong },
        disabled && { opacity: 0.4 },
      ]}
    >
      <Text
        style={{
          color: danger ? colors.danger : colors.accent,
          fontSize: 14,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function Button(props: ButtonProps & { primary?: boolean }) {
  return props.primary ? (
    <PrimaryButton {...props} />
  ) : (
    <GhostButton {...props} />
  );
}
export function TextLink({ label, onPress, disabled }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        minHeight: 44,
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={[styles.dim, { fontWeight: "500" }]}>{label} ›</Text>
    </Pressable>
  );
}
export function Input(props: TextInputProps) {
  const [focus, setFocus] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.mute}
      selectionColor={colors.accent}
      {...props}
      onFocus={(e) => {
        setFocus(true);
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocus(false);
        props.onBlur?.(e);
      }}
      style={[
        styles.input,
        props.multiline && { textAlignVertical: "top" },
        focus && {
          borderColor: colors.accent,
          backgroundColor: colors.accentSoft,
        },
        props.style,
      ]}
    />
  );
}
export function Tag({
  children,
  tone = "mute",
}: {
  children: React.ReactNode;
  tone?: "mute" | "accent" | "ok" | "warn" | "danger";
}) {
  return (
    <View
      style={{
        borderRadius: 6,
        paddingHorizontal: 6,
        minHeight: 20,
        justifyContent: "center",
        backgroundColor: tone === "mute" ? colors.ghost : colors[tone] + "1f",
      }}
    >
      <Text
        style={{
          ...type.caption,
          color: tone === "mute" ? colors.dim : colors[tone],
        }}
      >
        {children}
      </Text>
    </View>
  );
}
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <View style={[styles.row, { height: 18 }]}>
      <View style={{ width: 2, height: 10, backgroundColor: colors.accent }} />
      <Text style={{ ...type.caption, color: colors.dim }}>{children}</Text>
    </View>
  );
}
export function AgentBadge({
  id,
  size = "md",
  muted = false,
}: {
  id: string;
  size?: "md" | "sm";
  muted?: boolean;
}) {
  const color = muted ? colors.mute : (colors[id as AgentId] ?? colors.dim);
  return (
    <View
      style={{
        width: size === "sm" ? 16 : 22,
        height: size === "sm" ? 16 : 22,
        borderRadius: size === "sm" ? 5 : 7,
        backgroundColor: color + "24",
        borderColor: color + "66",
        borderWidth: 0.5,
        alignItems: "center",
        justifyContent: "center",
        opacity: muted ? 0.35 : 1,
      }}
    >
      <View
        style={{
          width: 16,
          height: 16,
          alignItems: "center",
          justifyContent: "center",
          transform: [{ scale: size === "sm" ? 0.72 : 1 }],
        }}
      >
        {id === "claude" ? (
          [0, 60, 120].map((a) => (
            <View
              key={a}
              style={{
                position: "absolute",
                width: 2,
                height: 12,
                borderRadius: 1,
                backgroundColor: color,
                transform: [{ rotate: `${a}deg` }],
              }}
            />
          ))
        ) : id === "codex" ? (
          <>
            {[-40, 40].map((a) => (
              <View
                key={a}
                style={{
                  position: "absolute",
                  left: 4,
                  top: a < 0 ? 3 : 7,
                  width: 2,
                  height: 6,
                  backgroundColor: color,
                  transform: [{ rotate: `${a}deg` }],
                }}
              />
            ))}
            <View
              style={{
                position: "absolute",
                bottom: 2,
                right: 1,
                width: 6,
                height: 2,
                backgroundColor: color,
              }}
            />
          </>
        ) : id === "grok" ? (
          <>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                borderWidth: 1.5,
                borderColor: color,
              }}
            />
            <View
              style={{
                position: "absolute",
                width: 2,
                height: 14,
                backgroundColor: color,
                transform: [{ rotate: "35deg" }],
              }}
            />
          </>
        ) : (
          <View
            style={{
              width: 10,
              height: 10,
              borderWidth: 1.5,
              borderColor: color,
              borderRadius: 3,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <View
              style={{
                width: 4,
                height: 4,
                borderRadius: 1,
                backgroundColor: color,
              }}
            />
          </View>
        )}
      </View>
    </View>
  );
}
export function OsGlyph({ os }: { os: Machine["os"] }) {
  return (
    <View
      style={{
        width: 20,
        height: 20,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {os === "win32" ? (
        <View
          style={{
            width: 14,
            height: 14,
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 2,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={{ width: 6, height: 6, backgroundColor: colors.dim }}
            />
          ))}
        </View>
      ) : os === "darwin" ? (
        <>
          <View
            style={{
              width: 16,
              height: 11,
              borderRadius: 2,
              borderWidth: 1,
              borderColor: colors.dim,
            }}
          />
          <View
            style={{
              width: 20,
              height: 1.5,
              marginTop: 2,
              backgroundColor: colors.dim,
            }}
          />
        </>
      ) : (
        <View style={{ gap: 3 }}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{ width: 14, height: 2, backgroundColor: colors.dim }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
export function QuotaBar({
  agent,
  compact = false,
}: {
  agent?: AgentInfo;
  compact?: boolean;
}) {
  const q = quotaView(agent);
  return (
    <View style={{ flex: 1, gap: 3 }}>
      {!compact && (
        <Text numberOfLines={1} style={{ ...type.caption, color: colors.dim }}>
          {q.label}
        </Text>
      )}
      {q.kind === "unknown" ? (
        <View
          style={{
            height: 3,
            flexDirection: "row",
            gap: 3,
            overflow: "hidden",
          }}
        >
          {Array.from({ length: 24 }, (_, i) => (
            <View
              key={i}
              style={{ width: 3, height: 3, backgroundColor: colors.mute }}
            />
          ))}
        </View>
      ) : q.kind !== "local" ? (
        <View style={{ height: 3, backgroundColor: colors.line }}>
          <View
            style={{
              height: 3,
              width: q.kind === "ratio" ? `${(q.ratio ?? 0) * 100}%` : 3,
              backgroundColor:
                q.ratio === 0
                  ? colors.danger
                  : (q.ratio ?? 1) <= 0.2
                    ? colors.warn
                    : colors.accent,
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
export function CodeCells({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 6, position: "relative" }}>
      {Array.from({ length: 6 }, (_, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: 52,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: i === value.length ? colors.accent : colors.lineStrong,
            backgroundColor: value[i] ? colors.accentSoft : colors.input,
            alignItems: "center",
            justifyContent: "center",
            marginLeft: i === 3 ? 6 : 0,
          }}
        >
          <Text style={{ ...type.stat, color: colors.text }}>{value[i]}</Text>
        </View>
      ))}
      <TextInput
        accessibilityLabel="六位配对码"
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, ""))}
        keyboardType="number-pad"
        maxLength={6}
        caretHidden
        style={[StyleSheet.absoluteFill, { color: colors.transparent }]}
      />
    </View>
  );
}
export function Brand() {
  return (
    <View style={styles.row}>
      <View
        style={{
          width: 18,
          height: 18,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: 13,
            height: 13,
            borderRadius: 4,
            backgroundColor: colors.accent,
            transform: [{ rotate: "45deg" }],
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <View style={{ width: 5, height: 5, backgroundColor: colors.bg }} />
        </View>
      </View>
      <Text style={styles.heading}>AgentDeck</Text>
    </View>
  );
}
export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: 16, paddingTop: 12, gap: 12, paddingBottom: 24 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  card: {
    backgroundColor: colors.glass,
    borderRadius: 16,
    padding: 12,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    overflow: "hidden",
  },
  title: { ...type.title, color: colors.text },
  heading: { ...type.heading, color: colors.text },
  text: { ...type.body, color: colors.text },
  dim: { ...type.small, color: colors.dim },
  accent: { ...type.small, color: colors.accent, fontWeight: "600" },
  button: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.ghost,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  primary: { backgroundColor: colors.accent },
  input: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.input,
    borderColor: colors.lineStrong,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    minHeight: 44,
    padding: 14,
  },
});

// Activity marks share the pulse clock; rows never create their own looping timer.
export function ActivityMark({
  active = true,
  style,
}: {
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const motion = useMotion();
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          backgroundColor: colors.accent,
          opacity:
            active && motion
              ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] })
              : 0.4,
        },
        style,
      ]}
    />
  );
}
export function StatNumber({
  value,
  total,
  color,
}: {
  value: number | string;
  total?: number;
  color: string;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    opacity.setValue(0.3);
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [value, total]);
  return (
    <Animated.Text style={{ ...type.stat, color, opacity }}>
      {value}
      {total !== undefined && (
        <Text style={{ fontSize: 16, color: colors.dim }}>/{total}</Text>
      )}
    </Animated.Text>
  );
}
export function ErrorBanner({
  text,
  onDismiss,
}: {
  text: string;
  onDismiss: () => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, []);
  return (
    <Animated.View
      accessibilityRole="alert"
      style={[
        styles.row,
        {
          margin: 16,
          marginVertical: 8,
          paddingLeft: 12,
          minHeight: 40,
          borderLeftWidth: 3,
          borderColor: colors.danger,
          backgroundColor: colors.glass,
          borderRadius: 12,
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-8, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Text style={[styles.dim, { color: colors.text, flex: 1 }]}>{text}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="关闭提示"
        onPress={onDismiss}
        style={{
          width: 44,
          height: 44,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text style={styles.dim}>✕</Text>
      </Pressable>
    </Animated.View>
  );
}
export function StreamCursor() {
  const motion = useMotion(),
    opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!motion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [motion]);
  return (
    <Animated.Text
      accessibilityElementsHidden
      style={{ color: colors.accent, opacity }}
    >
      ▏
    </Animated.Text>
  );
}
