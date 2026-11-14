import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  LayoutAnimation,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import type {
  Approval,
  EventEnvelope,
  Machine,
  RoutingDecision,
  Session,
} from "@agentdeck/protocol";
import {
  StreamCursor,
  AgentBadge,
  BlurDock,
  Button,
  GlassCard,
  GradientCard,
  Input,
  Tag,
  TextLink,
  styles as s,
  colors,
} from "./ui";
import { type } from "./theme";
import {
  agents,
  eventText,
  groupEvents,
  machineTitleById,
  reasonView,
  tidy,
  type AgentId,
  type EventGroup,
} from "./presentation";
const EventCard = memo(
  function EventCard({
    group,
    agent,
    onTools,
    running,
  }: {
    group: EventGroup;
    agent: string;
    onTools: () => void;
    running: boolean;
  }) {
    const [expanded, setExpanded] = useState(false),
      e = group.events[group.events.length - 1];
    const toggle = () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setExpanded((v) => !v);
    };
    if (group.kind === "tools")
      return (
        <TextLink
          label={`${group.events.filter((e) => e.type === "tool.call" || e.type === "command.exec" || e.type === "output.chunk").length || 1} 步工具调用`}
          onPress={onTools}
        />
      );
    if (
      [
        "session.status",
        "session.ended",
        "approval.request",
        "approval.resolve",
        "result.resolve",
      ].includes(group.kind)
    )
      return (
        <View style={[s.row, { height: 22 }]}>
          <View
            style={{
              width: 4,
              height: 4,
              backgroundColor: colors.dim,
              borderRadius: 2,
            }}
          />
          <Text
            numberOfLines={1}
            style={{ ...type.caption, color: colors.dim, flex: 1 }}
          >
            {group.text}
          </Text>
          <Text style={{ ...type.caption, color: colors.mute }}>
            {new Date(e.ts).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </Text>
        </View>
      );
    if (e.type === "file.change")
      return (
        <Pressable accessibilityRole="button" onPress={toggle}>
          <GlassCard style={{ padding: 8, borderRadius: 8 }}>
            <View style={s.row}>
              <Text style={s.accent}>
                {e.payload.kind === "add"
                  ? "+"
                  : e.payload.kind === "delete"
                    ? "−"
                    : "~"}
              </Text>
              <Text
                numberOfLines={1}
                ellipsizeMode="head"
                style={{ ...type.mono, color: colors.text, flex: 1 }}
              >
                {e.payload.path}
              </Text>
              <Tag tone={e.payload.kind === "delete" ? "danger" : "accent"}>
                {
                  { add: "新增", modify: "修改", delete: "删除" }[
                    e.payload.kind
                  ]
                }
              </Tag>
            </View>
            {expanded && e.payload.patch && (
              <Text
                selectable
                numberOfLines={12}
                style={{ ...type.mono, color: colors.dim }}
              >
                {e.payload.patch}
              </Text>
            )}
          </GlassCard>
        </Pressable>
      );
    if (e.type === "diff.snapshot" || e.type === "test.result")
      return (
        <GlassCard style={{ minHeight: 36, padding: 8 }}>
          <Text style={s.dim}>
            {e.type === "test.result"
              ? `${e.payload.ok ? "测试通过" : `${e.payload.failed} 项没过`}${e.payload.total !== undefined ? ` / 共 ${e.payload.total}` : ""}`
              : group.text}
          </Text>
        </GlassCard>
      );
    if (
      ["tool.call", "tool.result", "command.exec", "output.chunk"].includes(
        group.kind,
      )
    )
      return (
        <View>
          <TextLink
            label={
              e.type === "command.exec"
                ? `${e.payload.cmd} · 退出 ${e.payload.exitCode}`
                : group.events[0].type === "tool.call"
                  ? `${group.events[0].payload.name} · ${e.type === "tool.result" ? (e.payload.ok ? "完成" : "失败") : "进行中"}`
                  : e.type === "tool.result"
                    ? e.payload.ok
                      ? "完成"
                      : "失败"
                    : "终端输出"
            }
            onPress={toggle}
          />
          {expanded && (
            <GlassCard>
              <Text
                selectable
                numberOfLines={e.type === "output.chunk" ? 6 : 8}
                style={{ ...type.mono, color: colors.dim }}
              >
                {group.kind === "output.chunk"
                  ? group.text.split("\n").slice(-6).join("\n")
                  : group.text}
              </Text>
            </GlassCard>
          )}
        </View>
      );
    const reasoning = group.kind === "agent.reasoning",
      message = group.kind === "agent.message",
      user = group.kind === "user.input",
      error = e.type === "error";
    return (
      <Pressable
        accessibilityRole={reasoning ? "button" : undefined}
        onPress={reasoning ? toggle : undefined}
      >
        <GlassCard
          style={{
            padding: reasoning ? 10 : 12,
            borderRadius: 12,
            ...(message
              ? {
                  borderLeftWidth: 2,
                  borderLeftColor: colors[agent as AgentId] ?? colors.accent,
                }
              : {}),
            ...(user
              ? {
                  alignSelf: "flex-end",
                  maxWidth: "80%",
                  backgroundColor: colors.accentSoft,
                }
              : {}),
            ...(error ? { borderColor: colors.danger } : {}),
          }}
        >
          <View style={s.row}>
            {message && <AgentBadge id={agent} size="sm" />}
            <Text
              style={{
                ...type.caption,
                color: error
                  ? colors.danger
                  : reasoning
                    ? colors.dim
                    : (colors[agent as AgentId] ?? colors.accent),
              }}
            >
              {error
                ? "出错了"
                : reasoning
                  ? "思路"
                  : user
                    ? "你"
                    : (agents[agent as AgentId] ?? agent)}
            </Text>
            {reasoning && group.events.length > 1 && (
              <Tag>{group.events.length} 条</Tag>
            )}
            {error && e.payload.retriable && <Tag>可重试</Tag>}
          </View>
          <Text
            selectable
            numberOfLines={reasoning && !expanded ? 3 : undefined}
            style={reasoning ? s.dim : s.text}
          >
            {group.text}
            {message &&
              running &&
              e.type === "agent.message" &&
              !e.payload.final && <StreamCursor />}
          </Text>
        </GlassCard>
      </Pressable>
    );
  },
  (a, b) =>
    a.running === b.running &&
    a.group.kind === b.group.kind &&
    a.group.events[a.group.events.length - 1].seq ===
      b.group.events[b.group.events.length - 1].seq &&
    a.group.text === b.group.text &&
    a.agent === b.agent,
);
function ApprovalDock({
  approval,
  count,
  connected,
  onApprove,
}: {
  approval: Approval;
  count: number;
  connected: boolean;
  onApprove: (id: string, d: "allow" | "allow_always" | "deny") => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [approval.approvalId]);
  const seconds = Math.max(0, Math.ceil((approval.expiresAt - now) / 1000));
  return (
    <BlurDock
      style={{
        margin: 8,
        borderColor: approval.risk === "high" ? colors.danger : colors.line,
      }}
    >
      <View style={[s.row, { justifyContent: "space-between" }]}>
        <Tag
          tone={
            approval.risk === "high"
              ? "danger"
              : approval.risk === "medium"
                ? "warn"
                : "mute"
          }
        >
          {{ low: "低风险", medium: "中风险", high: "高风险" }[approval.risk]}
        </Tag>
        <Text style={s.dim}>
          {
            {
              shell: "命令",
              write: "写文件",
              network: "联网",
              spawn: "启动进程",
            }[approval.kind]
          }
        </Text>
        {count > 1 && <Tag>还有 {count - 1} 个</Tag>}
        <Text
          style={{
            ...type.caption,
            fontVariant: ["tabular-nums"],
            color: seconds <= 10 ? colors.danger : colors.dim,
          }}
        >
          {seconds} 秒
        </Text>
      </View>
      <Text numberOfLines={2} style={s.heading}>
        {tidy(approval.summary)}
      </Text>
      {approval.detail && (
        <Pressable onPress={() => Alert.alert("操作详情", approval.detail)}>
          <Text numberOfLines={2} style={{ ...type.mono, color: colors.dim }}>
            {approval.detail}
          </Text>
        </Pressable>
      )}
      <Text style={{ ...type.caption, color: colors.dim }}>
        超时算拒绝 拒绝会结束任务 已经执行的动作不一定拦得住
      </Text>
      <View style={s.row}>
        {(["deny", "allow_always", "allow"] as const).map((d) => (
          <View style={{ flex: 1 }} key={d}>
            <Button
              small
              primary={d === "allow"}
              danger={d === "deny"}
              label={
                { deny: "拒绝", allow_always: "以后都允许", allow: "允许" }[d]
              }
              onLongPress={
                d === "allow_always"
                  ? () =>
                      Alert.alert(
                        "以后都允许",
                        "只对这个任务里同样的工具和参数生效",
                      )
                  : undefined
              }
              disabled={
                !connected || seconds === 0 || !approval.options.includes(d)
              }
              onPress={() => onApprove(approval.approvalId, d)}
            />
          </View>
        ))}
      </View>
    </BlurDock>
  );
}
export type StreamProps = {
  session: Session;
  events: EventEnvelope[];
  approvals: Approval[];
  machines: Machine[];
  decision?: RoutingDecision;
  connected: boolean;
  text: string;
  setText: (s: string) => void;
  onApprove: (id: string, d: "allow" | "allow_always" | "deny") => void;
  onResult: (d: "accept" | "reject") => void;
  onSend: () => void;
  onInterject: () => void;
  onHalt: () => void;
};
export function StreamScreen(p: StreamProps) {
  const [mode, setMode] = useState<"key" | "all">("key"),
    [expanded, setExpanded] = useState(false),
    [newEvents, setNewEvents] = useState(false);
  const groups = useMemo(() => groupEvents(p.events, mode), [p.events, mode]);
  const scroll = useRef<ScrollView>(null),
    list = useRef<FlatList<EventGroup>>(null),
    bottom = useRef(true);
  const previous = useRef(0);
  const end = () => {
    scroll.current?.scrollToEnd({ animated: true });
    list.current?.scrollToEnd({ animated: true });
    bottom.current = true;
    setNewEvents(false);
  };
  useEffect(() => {
    if (p.events.length > previous.current && !bottom.current)
      setNewEvents(true);
    previous.current = p.events.length;
  }, [p.events.length]);
  const name = agents[p.session.agentId as AgentId] ?? p.session.agentId,
    reason = p.decision ? reasonView(p.decision, name) : undefined,
    active = !["done", "failed", "cancelled"].includes(p.session.status),
    reviewed = p.events.some((e) => e.type === "result.resolve"),
    hasResult = p.events.some((e) =>
      ["agent.message", "session.ended", "diff.snapshot"].includes(e.type),
    );
  const render = (group: EventGroup) => (
    <EventCard
      key={group.key}
      group={group}
      agent={p.session.agentId}
      running={active && group.key === groups[groups.length - 1]?.key}
      onTools={() => setMode("all")}
    />
  );
  return (
    <>
      <View style={{ marginHorizontal: 16, marginTop: 8 }}>
        <Pressable
          accessibilityRole="button"
          disabled={!p.decision}
          onPress={() => {
            LayoutAnimation.configureNext(
              LayoutAnimation.Presets.easeInEaseOut,
            );
            setExpanded((v) => !v);
          }}
        >
          <GradientCard
            corner={16}
            contentStyle={{ paddingVertical: 8, gap: 4 }}
          >
            <View style={s.row}>
              <AgentBadge id={p.session.agentId} />
              <Text style={s.heading}>{name}</Text>
              <Text style={s.dim}>→</Text>
              <Text
                numberOfLines={1}
                ellipsizeMode="middle"
                style={[s.dim, { flex: 1 }]}
              >
                {machineTitleById(
                  p.machines,
                  p.session.machineId,
                  p.session.machineId,
                )}
              </Text>
            </View>
            <View style={s.row}>
              <Tag tone={p.decision ? "accent" : "mute"}>
                {p.decision ? "自动分配" : "手动指定"}
              </Tag>
              <Text numberOfLines={1} style={[s.dim, { flex: 1 }]}>
                {reason?.short ?? "你选的设备和 AI"}
              </Text>
            </View>
            {reason && (
              <Text
                numberOfLines={1}
                style={{ ...type.caption, color: colors.dim }}
              >
                {reason.facts}　⌄
              </Text>
            )}
            {expanded && p.decision && (
              <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
                <Text selectable style={s.dim}>
                  {tidy(p.decision.reason)}
                </Text>
                <Text style={s.accent}>当时的候选</Text>
                {p.decision.candidates.slice(0, 6).map((c, i) => (
                  <View key={i} style={[s.row, { minHeight: 24 }]}>
                    <AgentBadge id={c.agentId} size="sm" />
                    <Text
                      style={{
                        ...type.caption,
                        color: c.eligible ? colors.text : colors.mute,
                        flex: 1,
                      }}
                    >
                      {machineTitleById(p.machines, c.machineId, c.machineId)} ·{" "}
                      {tidy(c.note)}
                    </Text>
                    {c.machineId === p.decision?.machineId &&
                      c.agentId === p.decision?.agentId && (
                        <Tag tone="accent">选中</Tag>
                      )}
                  </View>
                ))}
                {p.decision.candidates.length > 6 && (
                  <Text style={s.dim}>
                    还有 {p.decision.candidates.length - 6} 个
                  </Text>
                )}
              </ScrollView>
            )}
          </GradientCard>
        </Pressable>
      </View>
      <View style={[s.row, { paddingHorizontal: 16, height: 28 }]}>
        {(["key", "all"] as const).map((m) => (
          <Pressable
            key={m}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setMode(m)}
            style={{
              paddingHorizontal: 12,
              minHeight: 28,
              justifyContent: "center",
              borderRadius: 999,
              backgroundColor:
                mode === m ? colors.accentSoft : colors.transparent,
            }}
          >
            <Text
              style={{
                ...type.small,
                color: mode === m ? colors.accent : colors.dim,
              }}
            >
              {m === "key" ? "关键" : "全部"}
            </Text>
          </Pressable>
        ))}
        {newEvents && <TextLink label="有新进展 ↓" onPress={end} />}
      </View>
      {groups.length > 40 ? (
        <FlatList
          ref={list}
          data={groups}
          keyExtractor={(g) => String(g.key)}
          renderItem={({ item }) => render(item)}
          initialNumToRender={12}
          windowSize={7}
          removeClippedSubviews
          contentContainerStyle={{
            paddingHorizontal: 16,
            gap: 6,
            paddingBottom: 8,
          }}
          onScroll={(e) => {
            const n = e.nativeEvent;
            bottom.current =
              n.contentOffset.y + n.layoutMeasurement.height >=
              n.contentSize.height - 60;
          }}
          onContentSizeChange={() => {
            if (bottom.current) list.current?.scrollToEnd({ animated: true });
          }}
        />
      ) : (
        <ScrollView
          ref={scroll}
          contentContainerStyle={{
            paddingHorizontal: 16,
            gap: 6,
            paddingBottom: 8,
          }}
          scrollEventThrottle={16}
          onScroll={(e) => {
            const n = e.nativeEvent;
            bottom.current =
              n.contentOffset.y + n.layoutMeasurement.height >=
              n.contentSize.height - 60;
          }}
          onContentSizeChange={() => {
            if (bottom.current) scroll.current?.scrollToEnd({ animated: true });
          }}
        >
          {groups.length ? (
            groups.map(render)
          ) : (
            <Text style={[s.dim, { textAlign: "center", paddingVertical: 32 }]}>
              已连上 等它开口
            </Text>
          )}
        </ScrollView>
      )}
      {p.approvals.length ? (
        <ApprovalDock
          approval={p.approvals[0]}
          count={p.approvals.length}
          connected={p.connected}
          onApprove={p.onApprove}
        />
      ) : active ? (
        <BlurDock style={{ margin: 8 }}>
          <View style={s.row}>
            <Input
              accessibilityLabel="补充指令"
              editable={p.session.agentId === "claude"}
              placeholder={
                p.session.agentId === "claude"
                  ? "补一句"
                  : `${name} 暂不支持中途追加`
              }
              value={p.text}
              onChangeText={p.setText}
              style={{ flex: 1, height: 44, paddingVertical: 8 }}
            />
            <Button
              label="追加"
              small
              primary
              disabled={
                !p.connected || !p.text.trim() || p.session.agentId !== "claude"
              }
              onPress={p.onSend}
            />
          </View>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Button
                label="改方向"
                onLongPress={() =>
                  Alert.alert(
                    "追加和改方向",
                    "追加会等这一轮跑完再执行\n改方向会立刻打断 带着上下文重来",
                  )
                }
                disabled={
                  !p.connected ||
                  !p.text.trim() ||
                  p.session.agentId !== "claude" ||
                  p.session.status === "needs_approval"
                }
                onPress={p.onInterject}
              />
            </View>
            <Button
              label="停止"
              danger
              disabled={!p.connected}
              onPress={() =>
                Alert.alert("停掉这台电脑上的所有任务", "不只是当前这一个", [
                  { text: "再想想", style: "cancel" },
                  { text: "全部停止", style: "destructive", onPress: p.onHalt },
                ])
              }
            />
          </View>
        </BlurDock>
      ) : p.session.status === "done" && hasResult && !reviewed ? (
        <BlurDock style={{ margin: 8 }}>
          <View style={[s.row, { minHeight: 44 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[s.heading, { fontSize: 14 }]}>结果留下吗</Text>
              <Text
                style={{ ...type.caption, fontSize: 10, color: colors.dim }}
              >
                拒绝只做记录 不会回滚文件
              </Text>
            </View>
            <Button
              label="拒绝"
              disabled={!p.connected}
              onPress={() => p.onResult("reject")}
            />
            <Button
              label="接受"
              primary
              small
              disabled={!p.connected}
              onPress={() => p.onResult("accept")}
            />
          </View>
        </BlurDock>
      ) : null}
    </>
  );
}
