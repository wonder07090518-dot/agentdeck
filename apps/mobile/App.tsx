import Constants from "expo-constants";
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  Linking,
  AppState,
  Alert,
  Pressable,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type {
  Approval,
  EventEnvelope,
  Machine,
  RoutingDecision,
  Session,
} from "@agentdeck/protocol";
import { StreamScreen } from "./src/stream";
import { LoginScreen, ConsoleScreen, pairLink } from "./src/screens";
import { Client } from "./src/client";
import { installStorage, loadCredentials } from "./src/storage";
import {
  ErrorBanner,
  Backdrop,
  BlurDock,
  Brand,
  Pulse,
  Tag,
  styles as s,
  colors,
} from "./src/ui";
import {
  statuses,
  statusTone,
  selectable,
  tidy,
  type AgentId,
} from "./src/presentation";

type Page = "pair" | "connecting" | "list" | "stream";
function Deck() {
  const [page, setPage] = useState<Page>("connecting");
  const [relay, setRelay] = useState<string>(typeof Constants.expoConfig?.extra?.relayUrl === "string" ? Constants.expoConfig.extra.relayUrl : "");
  const [signedIn, setSignedIn] = useState(false);
  const [code, setCode] = useState("");
  const [connected, setConnected] = useState(false);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [machineId, setMachineId] = useState<string>();
  const [decisions, setDecisions] = useState<Record<string, RoutingDecision>>(
    {},
  );
  const pendingDecision = useRef<RoutingDecision | undefined>(undefined);
  const pendingTask = useRef<string | undefined>(undefined);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [session, setSession] = useState<Session>();
  const [events, setEvents] = useState<EventEnvelope[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [agent, setAgent] = useState<AgentId>();
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [direct, setDirect] = useState(false);
  const client = useRef<Client | undefined>(undefined);
  const ready = useRef(false);

  function act(action: () => void) {
    try {
      setError("");
      action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "没发出去 再试一次");
      setBusy(false);
    }
  }
  function setup(url: string) {
    client.current?.close();
    setMachines([]);
    setSessions([]);
    pendingDecision.current = undefined;
    const next = new Client(url);
    client.current = next;
    next.onConnection = (value) => {
      ready.current = value;
      setConnected(value);
    };
    setSignedIn(false);
    next.onAccount = setSignedIn;
    next.onAccountDeleted = () => {setSignedIn(false);setConnected(false);setMachines([]);setSessions([]);setPage("pair");};
    next.onFleet = (value) => {
      setMachines(value);
    };
    next.onMachine = (value) =>
      setMachines((old) => [...old.filter((m) => m.id !== value.id), value]);
    next.onRoutingDecision = (value) => {
      pendingDecision.current = value;
    };
    next.onUnauthorized = () => {
      setPage("pair");
      setMachines([]);
    };
    next.onMagicSent = (via) => {setBusy(false);setError(via==='desktop'?'验证码会显示在已登录的电脑上':'验证码已发到邮箱');};
    next.onError = (message) => {
      setError(message);
      setBusy(false);
    };
    next.onReady = () => {
      setPage((p) => (p === "pair" || p === "connecting" ? "list" : p));
      setBusy(false);
      setError("");
      const q = pendingTask.current;
      if (q) {
        pendingTask.current = undefined;
        setPrompt(q);
        setDirect(false);
        setBusy(true);
        try {
          next.create(q.trim(), { route: "auto" });
        } catch (err) {
          setError(err instanceof Error ? err.message : "任务没建成 再试一次");
          setBusy(false);
        }
      }
    };
    next.onSessions = setSessions;
    next.onAccepted = (accepted) => {
      if (pendingDecision.current) {
        const decision = pendingDecision.current;
        setDecisions((old) => ({ ...old, [accepted.id]: decision }));
        pendingDecision.current = undefined;
      }
      setSession(accepted);
      setEvents([]);
      setApprovals([]);
      setPage("stream");
      setBusy(false);
      setPrompt("");
      next.subscribe({ sessionId: accepted.id });
    };
    next.onSnapshot = (snapshot) => {
      setSession(snapshot.session);
      setEvents(snapshot.recent);
      setApprovals(snapshot.pendingApprovals);
    };
    next.onEvent = (event) => {
      setEvents((old) =>
        old.some((e) => e.seq === event.seq) ? old : [...old, event],
      );
      if (event.type === "approval.request")
        setApprovals((old) => [
          ...old.filter((a) => a.approvalId !== event.payload.approvalId),
          event.payload,
        ]);
      if (event.type === "approval.resolve")
        setApprovals((old) =>
          old.filter((a) => a.approvalId !== event.payload.approvalId),
        );
      if (event.type === "session.status" || event.type === "session.ended") {
        const status =
          event.type === "session.status"
            ? event.payload.to
            : event.payload.status;
        setSession((old) =>
          old?.id === event.sessionId ? { ...old, status } : old,
        );
        next.list();
      }
    };
    return next;
  }
  useEffect(() => {
    installStorage();
    let alive = true;
    const link = (url: string | null) => {
      if (!url) return false;
      try {
        const match = pairLink(url);
        if (!match) return false;
        const r = match.relay,
          c = match.code;
        client.current?.close();
        setConnected(false);
        setPage("pair");
        setRelay(r);
        setCode(c);
        if (r && /^\d{6}$/.test(c)) {
          setBusy(true);
          setTimeout(() => {
            try {
              setup(r.trim()).pair(c);
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "没配上 检查地址和六位码",
              );
              setBusy(false);
            }
          }, 0);
        }
        return true;
      } catch {
        return false;
      }
    };
    const linkTask = (url: string | null) => {
      if (!url) return false;
      try {
        const parsed = new URL(url);
        const path = decodeURIComponent(parsed.pathname || "");
        const isTask =
          (parsed.protocol === "agentdeck:" &&
            (parsed.hostname === "task" || parsed.host === "task")) ||
          path.includes("--/task");
        if (!isTask) return false;
        const q = parsed.searchParams.get("prompt") ?? "";
        if (q) {
          setPrompt(q);
          setDirect(false);
          if (ready.current && client.current) {
            setBusy(true);
            act(() => client.current?.create(q.trim(), { route: "auto" }));
          } else pendingTask.current = q;
        }
        return false;
      } catch {
        return false;
      }
    };
    void (async () => {
      try {
        const initial = await Linking.getInitialURL();
        if (initial) linkTask(initial);
        if (!alive || link(initial)) return;
        const stored = await loadCredentials();
        if (alive && stored) {
          setRelay(stored.relayUrl);
          setup(stored.relayUrl).auth(stored.token);
        } else if (alive) setPage("pair");
      } catch {
        if (alive) {
          setPage("pair");
          setError("连接恢复不了 重新配对一次");
        }
      }
    })();
    const listener = Linking.addEventListener("url", (e) => {
      if (!link(e.url)) linkTask(e.url);
    });
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active" && client.current)
        act(() => client.current?.refresh());
    });
    return () => {
      alive = false;
      listener.remove();
      foreground.remove();
      client.current?.close();
    };
  }, []);

  function open(item: Session) {
    act(() => {
      setSession(item);
      setEvents([]);
      setApprovals([]);
      client.current?.subscribe({ sessionId: item.id });
      setPage("stream");
    });
  }
  const routingEvent = events.find((e) => e.type === "routing.decision");
  const decision =
    routingEvent?.type === "routing.decision"
      ? routingEvent.payload
      : session
        ? decisions[session.id]
        : undefined;
  const back = () => {
    setPage("list");
    if (connected) act(() => client.current?.list());
  };

  function pair(r: string, c: string) {
    act(() => {
      setRelay(r);
      setCode(c);
      setBusy(true);
      setup(r.trim()).pair(c);
    });
  }
  function create() {
    act(() => {
      if (
        direct &&
        (!agent ||
          !selectable(
            machines.find((m) => m.id === machineId),
            agent,
          ))
      )
        throw Error("先选一台在线设备和一个可用的 AI");
      pendingDecision.current = undefined;
      setBusy(true);
      client.current?.create(prompt.trim(), {
        route: direct ? "direct" : "auto",
        ...(direct ? { agent, machineId } : {}),
        cwd: cwd.trim() || undefined,
      });
    });
  }
  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      <Backdrop stream={page === "stream"} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <BlurDock style={{ borderRadius: 0 }}>
          <View
            style={[
              s.row,
              {
                height: 26,
                justifyContent: "space-between",
                paddingHorizontal: 8,
              },
            ]}
          >
            {page === "stream" && session ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="返回"
                  onPress={back}
                  hitSlop={8}
                  style={{ width: 44, minHeight: 44, justifyContent: "center" }}
                >
                  <Text style={{ color: colors.accent, fontSize: 28 }}>‹</Text>
                </Pressable>
                <Text
                  numberOfLines={1}
                  style={[s.heading, { flex: 1, fontSize: 15 }]}
                >
                  {session.title}
                </Text>
                <Tag
                  tone={
                    !connected ||
                    machines.find((m) => m.id === session.machineId)?.online ===
                      false
                      ? "warn"
                      : statusTone(session.status)
                  }
                >
                  {!connected
                    ? "重连中"
                    : machines.find((m) => m.id === session.machineId)
                          ?.online === false
                      ? "电脑离线"
                      : statuses[session.status]}
                </Tag>
              </>
            ) : (
              <>
                <Brand />
                {page === "list" && (
                  <View style={s.row}>
                    <Pulse color={connected ? colors.ok : colors.warn} />
                    <Text style={s.dim}>{connected ? "已连接" : "重连中"}</Text>
                  </View>
                )}
              </>
            )}
          </View>
        </BlurDock>
        {error !== "" && (
          <ErrorBanner text={tidy(error)} onDismiss={() => setError("")} />
        )}
        {page === "connecting" && (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 20,
            }}
          >
            <Pulse color={colors.accent} />
            <Text style={s.heading}>正在连接你的电脑</Text>
            <Text style={s.dim}>登过一次就会自动连上</Text>
          </View>
        )}
        {page === "pair" && (
          <LoginScreen
            relay={relay}
            setRelay={setRelay}
            code={code}
            setCode={setCode}
            busy={busy}
            onMagic={(email,code)=>act(()=>{setBusy(true);const next=setup(relay.trim());if(code)next.magicComplete(email,code);else next.magicStart(email);})}
            onLogin={(email,password,register)=>act(()=>{setBusy(true);const next=setup(relay.trim());if(register)next.register(email,password);else next.login(email,password);})}
            onPair={() => pair(relay, code)}
            onScan={pair}
          />
        )}
        {page === "list" && (
          <ConsoleScreen
            machines={machines}
            sessions={sessions}
            connected={connected}
            busy={busy}
            prompt={prompt}
            setPrompt={setPrompt}
            cwd={cwd}
            setCwd={setCwd}
            machineId={machineId}
            setMachineId={setMachineId}
            agent={agent}
            setAgent={setAgent}
            direct={direct}
            setDirect={setDirect}
            onCreate={create}
            onOpen={open}
            onDeleteAccount={signedIn ? () => Alert.alert("删除账号", "账号 设备令牌和设备列表都会从中转删除 不能恢复", [
              {text:"取消",style:"cancel"},
              {text:"删除",style:"destructive",onPress:()=>act(()=>client.current?.deleteAccount())},
            ]) : undefined}
            onRepair={() => Alert.alert("连接设置", "", [
              {text:"重新连接",onPress:()=>act(()=>client.current?.refresh())},
              {text:"退出登录",style:"destructive",onPress:()=>{
                void client.current?.logout().catch(()=>setError("令牌没清掉 去系统设置里清除应用数据"));
                setConnected(false);setMachines([]);setSessions([]);setPage("pair");
              }},
              {text:"取消",style:"cancel"},
            ])}
          />
        )}
        {page === "stream" && session && (
          <StreamScreen
            key={session.id}
            session={session}
            events={events}
            approvals={approvals}
            machines={machines}
            decision={decision}
            connected={connected}
            text={text}
            setText={setText}
            onApprove={(id, d) => act(() => client.current?.approve(id, d))}
            onResult={(d) => act(() => client.current?.result(session.id, d))}
            onSend={() =>
              act(() => {
                client.current?.sendText(session.id, text.trim());
                setText("");
              })
            }
            onInterject={() =>
              act(() => {
                client.current?.interject(session.id, text.trim());
                setText("");
              })
            }
            onHalt={() => act(() => client.current?.halt())}
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export default function App() {
  return (
    <SafeAreaProvider>
      <Deck />
    </SafeAreaProvider>
  );
}
