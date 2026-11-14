import React, { useRef, useState } from "react";
import {
  Linking,
  LayoutAnimation,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import type { Machine, Session } from "@agentdeck/protocol";
import {
  ActivityMark,
  StatNumber,
  AgentBadge,
  Button,
  CodeCells,
  GlassCard,
  GradientCard,
  Input,
  OsGlyph,
  Pulse,
  QuotaBar,
  SectionLabel,
  Tag,
  TextLink,
  styles as s,
  colors,
} from "./ui";
import { type, glow } from "./theme";
import {
  pairLink,
  agents,
  agentStatus,
  agentTile,
  fleetStats,
  machineTitleById,
  osKind,
  quotaView,
  relative,
  selectable,
  statuses,
  statusTone,
  type AgentId,
} from "./presentation";
export { pairLink } from "./presentation";
type PairProps = {
  relay: string;
  setRelay: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
  busy: boolean;
  onPair: () => void;
  onScan: (relay: string, code: string) => void;
};
function SupportLinks() {
  return <View style={s.row}>
    <TextLink label="隐私政策" onPress={() => {void Linking.openURL("https://agentdeckapp.com/privacy").catch(() => {});}} />
    <TextLink label="帮助" onPress={() => {void Linking.openURL("https://agentdeckapp.com/support").catch(() => {});}} />
  </View>;
}
export function LoginScreen(
  props: PairProps & {
    onLogin: (email: string, password: string, register: boolean) => void;
    onMagic: (email: string, code?: string) => void;
  },
) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [backup, setBackup] = useState(false),
    [address, setAddress] = useState(false),
    [magic, setMagic] = useState(false),
    [magicCode, setMagicCode] = useState("");
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[s.body, { gap: 16 }]}
    >
      <View style={{ alignItems: "center", gap: 8, paddingTop: 24 }}>
        <Text style={{ ...type.display, color: colors.text }}>
          登录 AgentDeck
        </Text>
        <Text style={s.dim}>电脑和手机用同一个账号</Text>
      </View>
      <GradientCard>
        <Text style={s.dim}>邮箱</Text>
        <Input
          accessibilityLabel="邮箱"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <Text style={s.dim}>密码</Text>
        <Input
          accessibilityLabel="密码"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
        />
        <Button
          label="登录"
          primary
          disabled={props.busy || !email || !password}
          onPress={() => {
            props.onLogin(email, password, false);
            setPassword("");
          }}
        />
        <Button
          label="创建账号"
          disabled={props.busy || !email || password.length < 8}
          onPress={() => {
            props.onLogin(email, password, true);
            setPassword("");
          }}
        />
        <Text style={s.dim}>密码至少 8 位</Text>
      </GradientCard>
      <Text style={[s.dim, { textAlign: "center" }]}>登过一次就会自动连上</Text>
      <TextLink label="用验证码" onPress={() => setMagic(!magic)} />
      {magic && (
        <GlassCard>
          <Text style={s.dim}>验证码会显示在已登录的电脑上</Text>
          <Button
            label="获取验证码"
            disabled={props.busy || !email}
            onPress={() => props.onMagic(email)}
          />
          <Input
            accessibilityLabel="登录验证码"
            value={magicCode}
            onChangeText={setMagicCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Button
            label="验证码登录"
            disabled={props.busy || magicCode.length !== 6}
            onPress={() => props.onMagic(email, magicCode)}
          />
        </GlassCard>
      )}
      <TextLink label="中转地址" onPress={() => setAddress(!address)} />
      {address && (
        <Input
          accessibilityLabel="中转地址"
          value={props.relay}
          onChangeText={props.setRelay}
          autoCapitalize="none"
        />
      )}
      <TextLink label="扫码 / 手动六位码" onPress={() => setBackup(!backup)} />
      {backup && <PairScreen {...props} />}
      <SupportLinks />
    </ScrollView>
  );
}
export function PairScreen({
  relay,
  setRelay,
  code,
  setCode,
  busy,
  onPair,
  onScan,
}: PairProps) {
  const [manual, setManual] = useState(false),
    [camera, setCamera] = useState(false),
    [hint, setHint] = useState(""),
    [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  async function openCamera() {
    try {
      const result = permission?.granted
        ? permission
        : await requestPermission();
      if (result.granted) {
        scanned.current = false;
        setCamera(true);
        setHint("");
      } else setHint("相机权限没有打开 可以在系统设置中允许 或用手动输入");
    } catch {
      setCamera(false);
      setHint("这台设备暂时用不了相机 可以手动输入");
    }
  }
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[s.body, { gap: 16 }]}
    >
      <View style={{ alignItems: "center", gap: 8, paddingTop: 24 }}>
        <Text style={{ ...type.display, color: colors.text }}>
          连上你的电脑
        </Text>
        <Text style={s.dim}>扫描电脑上的二维码</Text>
      </View>
      <View
        style={{
          height: 280,
          borderRadius: 28,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: colors.lineStrong,
          backgroundColor: colors.bgRaised,
          alignItems: "center",
          justifyContent: "center",
          marginHorizontal: 12,
        }}
      >
        {camera && permission?.granted ? (
          <CameraView
            style={{ position: "absolute", width: "100%", height: "100%" }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onMountError={() => {
              setCamera(false);
              setHint("这台设备暂时用不了相机 可以手动输入");
            }}
            onBarcodeScanned={({ data }) => {
              if (busy || scanned.current) return;
              const link = pairLink(data);
              if (!link) {
                setHint("这个二维码不是配对码 对准电脑上的 AgentDeck 二维码");
                return;
              }
              scanned.current = true;
              setCamera(false);
              onScan(link.relay, link.code);
            }}
          />
        ) : (
          <View style={{ alignItems: "center", gap: 20 }}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 24,
                borderColor: colors.accent,
                borderWidth: 1,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  borderWidth: 2,
                  borderColor: colors.accent,
                }}
              />
            </View>
            <Text style={s.dim}>对准电脑上的二维码</Text>
          </View>
        )}
        {camera && (
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              bottom: 24,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 12,
              backgroundColor: colors.glassStrong,
            }}
          >
            <Text style={s.text}>对准电脑上的二维码</Text>
          </View>
        )}
        {[0, 1, 2, 3].map((i) => (
          <View
            pointerEvents="none"
            key={i}
            style={{
              position: "absolute",
              width: 28,
              height: 28,
              borderColor: colors.accent,
              ...(i < 2
                ? { top: 16, borderTopWidth: 3 }
                : { bottom: 16, borderBottomWidth: 3 }),
              ...(i % 2
                ? { right: 16, borderRightWidth: 3 }
                : { left: 16, borderLeftWidth: 3 }),
              borderRadius: 6,
            }}
          />
        ))}
      </View>
      {!camera && (
        <Button
          label={busy ? "正在连接…" : "打开相机"}
          primary
          disabled={busy}
          onPress={() => void openCamera()}
        />
      )}
      <Text style={[s.dim, { textAlign: "center" }]}>
        {hint || "配过一次就会自动连上"}
      </Text>
      <TextLink
        label="手动输入"
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setManual((v) => !v);
        }}
      />
      {manual && (
        <GradientCard>
          <Text style={s.dim}>中转地址</Text>
          <Input
            accessibilityLabel="中转地址"
            value={relay}
            onChangeText={setRelay}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="wss://relay.example.com"
          />
          {relay && !relay.startsWith("wss://") && (
            <Text style={{ ...type.caption, color: colors.warn }}>
              地址要以 wss:// 开头
            </Text>
          )}
          <Text style={s.dim}>配对码</Text>
          <CodeCells value={code} onChange={setCode} />
          <Button
            label={busy ? "正在连接…" : "连接"}
            primary
            disabled={
              busy || !/^\d{6}$/.test(code) || !relay.startsWith("wss://")
            }
            onPress={onPair}
          />
        </GradientCard>
      )}
      <Text
        style={{
          ...type.caption,
          color: colors.dim,
          textAlign: "center",
          lineHeight: 20,
        }}
      >
        配对码 5 分钟内有效{"\n"}令牌只存在这台手机的安全存储里{"\n"}
        中转需要手机信任的 TLS 证书
      </Text>
    </ScrollView>
  );
}
export type ConsoleProps = {
  machines: Machine[];
  sessions: Session[];
  connected: boolean;
  busy: boolean;
  prompt: string;
  setPrompt: (v: string) => void;
  cwd: string;
  setCwd: (v: string) => void;
  machineId?: string;
  setMachineId: (v: string) => void;
  agent?: AgentId;
  setAgent: (v: AgentId | undefined) => void;
  direct: boolean;
  setDirect: (v: boolean) => void;
  onCreate: () => void;
  onOpen: (s: Session) => void;
  onRepair: () => void;
  onDeleteAccount?: () => void;
};
export function DirectPanel(p: ConsoleProps) {
  const machine = p.machines.find((m) => m.id === p.machineId);
  return (
    <View style={{ gap: 8 }}>
      <SectionLabel>设备</SectionLabel>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {p.machines.map((m) => (
          <Pressable
            key={m.id}
            accessibilityRole="button"
            accessibilityState={{
              disabled: !m.online,
              selected: p.machineId === m.id,
            }}
            disabled={!m.online}
            onPress={() => {
              p.setMachineId(m.id);
              p.setAgent(undefined);
            }}
            style={[
              s.row,
              {
                height: 44,
                borderRadius: 999,
                paddingHorizontal: 12,
                borderWidth: 1,
                borderColor:
                  p.machineId === m.id ? colors.accent : colors.lineStrong,
                backgroundColor:
                  p.machineId === m.id ? colors.accentSoft : colors.ghost,
                opacity: m.online ? 1 : 0.4,
              },
            ]}
          >
            <Pulse online={m.online} animate={false} />
            <Text
              numberOfLines={1}
              ellipsizeMode="middle"
              style={[s.dim, { maxWidth: 140 }]}
            >
              {m.name}
            </Text>
            <Tag>{osKind(m.os)}</Tag>
            {p.machineId === m.id && <Text style={s.accent}>✓</Text>}
            {!m.online && <Text style={s.dim}>离线</Text>}
          </Pressable>
        ))}
      </ScrollView>
      <SectionLabel>AI</SectionLabel>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {(Object.keys(agents) as AgentId[]).map((id) => (
          <Pressable
            key={id}
            accessibilityRole="button"
            disabled={!selectable(machine, id)}
            onPress={() => p.setAgent(id)}
            style={{
              width: "49%",
              minHeight: 54,
              borderRadius: 12,
              padding: 8,
              backgroundColor: p.agent === id ? colors.accentSoft : colors.tile,
              borderWidth: 1,
              borderColor: p.agent === id ? colors.accent : colors.line,
              opacity: selectable(machine, id) ? 1 : 0.4,
            }}
          >
            <View style={s.row}>
              <AgentBadge id={id} />
              <Text style={s.dim}>
                {agents[id]}
                {p.agent === id ? " ✓" : ""}
              </Text>
            </View>
            <Text style={{ ...type.caption, color: colors.dim }}>
              {agentTile(machine?.agents.find((a) => a.id === id)).label}
            </Text>
          </Pressable>
        ))}
      </View>
      <SectionLabel>工作目录</SectionLabel>
      <Input
        accessibilityLabel="工作目录（可选）"
        placeholder="不填就用电脑上的启动目录"
        value={p.cwd}
        onChangeText={p.setCwd}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}
export function ConsoleScreen(p: ConsoleProps) {
  const stats = fleetStats(p.machines, p.sessions);
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    p.setDirect(!p.direct);
  };
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={s.body}
    >
      <GlassCard
        style={{ height: 72, padding: 0, opacity: p.connected ? 1 : 0.5 }}
      >
        <View style={[s.row, { flex: 1, gap: 0 }]}>
          {[
            [stats.online, "设备在线"],
            [stats.ready, "AI 就绪"],
            [stats.active, "进行中"],
          ].map(([value, label], i) => (
            <View
              key={label}
              style={{
                flex: 1,
                paddingHorizontal: 14,
                borderLeftWidth: i ? 1 : 0,
                borderColor: colors.line,
                gap: 4,
              }}
            >
              <View style={[s.row, { gap: 3 }]}>
                {i === 0 && stats.online > 0 && <Pulse animate={p.connected} />}
                <StatNumber
                  value={stats.total ? value : "–"}
                  total={i === 0 && stats.total > 0 ? stats.total : undefined}
                  color={
                    !stats.total
                      ? colors.mute
                      : i === 2 && stats.approval
                        ? colors.warn
                        : i === 1 || (i === 2 && stats.active > 0)
                          ? colors.accent
                          : colors.text
                  }
                />
                {i === 2 && stats.active > 0 && (
                  <ActivityMark
                    active={p.connected}
                    style={{
                      position: "absolute",
                      bottom: -4,
                      left: 0,
                      width: 24,
                      height: 2,
                    }}
                  />
                )}
              </View>
              <Text style={{ ...type.caption, color: colors.dim }}>
                {label}
              </Text>
            </View>
          ))}
        </View>
        {!p.connected && (
          <View style={{ position: "absolute", right: 4, top: 0 }}>
            <Tag tone="warn">状态待刷新</Tag>
          </View>
        )}
      </GlassCard>
      <GradientCard
        compact
        style={{ backgroundColor: colors.bgRaised, ...glow.glowCard }}
      >
        <View style={[s.row, { height: 26, justifyContent: "space-between" }]}>
          <Text style={s.title}>交给 AI</Text>
          <Tag tone={p.direct ? "mute" : "accent"}>
            {p.direct ? "手动指定" : "自动分配"}
          </Tag>
        </View>
        <Input
          accessibilityLabel="任务描述"
          placeholder="想让它做什么"
          multiline
          value={p.prompt}
          onChangeText={p.setPrompt}
          style={{ height: 88, maxHeight: 160 }}
        />
        {!p.direct && p.cwd !== "" && (
          <TextLink label={`目录 ${p.cwd} ×`} onPress={() => p.setCwd("")} />
        )}
        {!p.direct && (
          <Button
            label={p.busy ? "正在分配…" : "开始"}
            primary
            busy={p.busy}
            disabled={!p.connected || p.busy || !p.prompt.trim()}
            onPress={p.onCreate}
          />
        )}
        <Pressable
          accessibilityRole="button"
          disabled={!p.connected}
          hitSlop={{ top: 4, bottom: 4 }}
          onPress={toggle}
          style={[s.row, { minHeight: 36, justifyContent: "space-between" }]}
        >
          <Text style={s.dim}>指定设备和 AI　可选</Text>
          <Text style={s.dim}>{p.direct ? "⌃" : "⌄"}</Text>
        </Pressable>
        {p.direct && (
          <>
            <DirectPanel {...p} />
            <Button
              primary
              label={
                p.busy
                  ? "正在创建…"
                  : !p.machineId
                    ? "先选一台设备"
                    : !p.agent
                      ? "再选一个 AI"
                      : "开始"
              }
              disabled={
                !p.connected ||
                p.busy ||
                !p.prompt.trim() ||
                !p.agent ||
                !selectable(
                  p.machines.find((m) => m.id === p.machineId),
                  p.agent,
                )
              }
              onPress={p.onCreate}
            />
          </>
        )}
      </GradientCard>
      <SectionLabel>设备</SectionLabel>
      {!p.machines.length && (
        <GlassCard
          style={{ height: 96, justifyContent: "center", alignItems: "center" }}
        >
          <Pulse online={false} />
          <Text style={s.dim}>还没有电脑连上</Text>
          <Text style={s.dim}>在电脑上启动 AgentDeck 就会出现在这里</Text>
        </GlassCard>
      )}
      {p.machines.map((m, index) => (
        <GlassCard
          gradient={m.online && index < 3}
          key={m.id}
          style={{
            height: 168,
            opacity: m.online ? 1 : 0.55,
            borderColor: m.online ? colors.lineStrong : colors.line,
          }}
        >
          <View style={[s.row, { height: 28 }]}>
            <OsGlyph os={m.os} />
            <Text
              numberOfLines={1}
              ellipsizeMode="middle"
              style={[s.heading, { flex: 1 }]}
            >
              {m.name}
            </Text>
            <Tag>{osKind(m.os)}</Tag>
            <Pulse
              online={m.online}
              animate={p.connected && index < 3}
              color={p.connected ? colors.ok : colors.warn}
            />
            <Text
              style={{
                ...type.caption,
                color: p.connected
                  ? m.online
                    ? colors.ok
                    : colors.mute
                  : colors.warn,
              }}
            >
              {!p.connected ? "待刷新" : m.online ? "在线" : "离线"}
            </Text>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {(Object.keys(agents) as AgentId[]).map((id) => {
              const a = m.agents.find((a) => a.id === id),
                state = agentTile(a),
                installed = !!a && a.installed !== false;
              return (
                <View
                  key={id}
                  accessibilityLabel={`${agents[id]} ${agentStatus(a)}`}
                  style={{
                    width: "49%",
                    height: 50,
                    borderRadius: 12,
                    backgroundColor: colors.tile,
                    paddingHorizontal: 8,
                    paddingTop: 3,
                    opacity: installed && a.dispatchable !== true ? 0.6 : 1,
                  }}
                >
                  <View style={[s.row, { height: 22, gap: 5 }]}>
                    <AgentBadge
                      id={id}
                      muted={!installed || a.dispatchable !== true}
                    />
                    <Text
                      numberOfLines={1}
                      style={{
                        ...type.small,
                        color: installed ? colors.text : colors.mute,
                        fontWeight: "600",
                      }}
                    >
                      {agents[id]}
                    </Text>
                  </View>
                  <View
                    style={[s.row, { justifyContent: "space-between", gap: 2 }]}
                  >
                    <Text
                      style={{
                        ...type.caption,
                        fontSize: 10,
                        color: colors[state.color],
                      }}
                    >
                      {state.label}
                    </Text>
                    {installed && (
                      <Text
                        numberOfLines={1}
                        style={{
                          ...type.caption,
                          fontSize: 10,
                          color: colors.dim,
                          flexShrink: 1,
                        }}
                      >
                        {quotaView(a).label}
                      </Text>
                    )}
                  </View>
                  {installed && (
                    <View
                      style={{
                        position: "absolute",
                        bottom: 3,
                        left: 8,
                        right: 8,
                      }}
                    >
                      <QuotaBar agent={a} compact />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </GlassCard>
      ))}
      <SectionLabel>最近任务　{p.sessions.length}</SectionLabel>
      {!p.sessions.length && (
        <Text style={[s.dim, { textAlign: "center", paddingVertical: 24 }]}>
          写个任务 让电脑上的 AI 开始干活
        </Text>
      )}
      {p.sessions.map((item, index) => (
        <Pressable
          accessibilityRole="button"
          key={item.id}
          onPress={() => p.onOpen(item)}
        >
          <GlassCard
            style={{ height: 60, flexDirection: "row", alignItems: "center" }}
          >
            {!["done", "failed", "cancelled"].includes(item.status) && (
              <ActivityMark
                active={p.connected && index < 3}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: 2,
                }}
              />
            )}
            <AgentBadge id={item.agentId} size="sm" />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={s.heading}>
                {item.title}
              </Text>
              <Text
                numberOfLines={1}
                style={{ ...type.caption, color: colors.dim }}
              >
                {agents[item.agentId as AgentId]} ·{" "}
                {machineTitleById(p.machines, item.machineId, item.machineId)} ·{" "}
                {relative(item.startedAt)}
              </Text>
            </View>
            <Tag
              tone={
                !p.connected &&
                !["done", "failed", "cancelled"].includes(item.status)
                  ? "warn"
                  : statusTone(item.status)
              }
            >
              {!p.connected &&
              !["done", "failed", "cancelled"].includes(item.status)
                ? "重连中"
                : statuses[item.status]}
            </Tag>
          </GlassCard>
        </Pressable>
      ))}
      <TextLink label="退出登录 / 重新连接" onPress={p.onRepair} />
      {p.onDeleteAccount && <Pressable accessibilityRole="button" accessibilityLabel="删除账号" onPress={p.onDeleteAccount}>
        <Text style={{...type.caption, color: colors.danger}}>删除账号</Text>
      </Pressable>}
      <SupportLinks />
      <Text style={{ ...type.caption, color: colors.mute }}>
        只在要换中转或令牌失效时才用
      </Text>
    </ScrollView>
  );
}
