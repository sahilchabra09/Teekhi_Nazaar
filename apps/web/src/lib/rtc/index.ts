"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RobotStreamConnection } from "./robot-stream";
import type { HubClient, RobotStream } from "./robot-stream";

export type { HubClient, HubMessage, RobotStream } from "./robot-stream";

export function useRobotStream(hub: HubClient | null, opts?: { sendLocal?: MediaStream }) {
  const [stream, setStream] = useState<RobotStream>({ remote: null, state: "idle", fallbackFrameUrl: null });
  const local = opts?.sendLocal;
  const localRef = useRef(local);
  const connectionRef = useRef<RobotStreamConnection | null>(null);
  const setLocal = useCallback(async (input?: MediaStream) => {
    const connection = connectionRef.current;
    await connection?.setLocal(input);
    localRef.current = input;
    if (connection !== connectionRef.current) await connectionRef.current?.setLocal(input);
  }, []);
  useEffect(() => {
    if (!hub) { setStream({ remote: null, state: "idle", fallbackFrameUrl: null }); return; }
    const connection = new RobotStreamConnection(hub, setStream, localRef.current);
    connectionRef.current = connection;
    return () => { connection.close(); connectionRef.current = null; };
  }, [hub]);
  useEffect(() => { void setLocal(local).catch(() => {}); }, [local, setLocal]);
  return { ...stream, setLocal };
}
