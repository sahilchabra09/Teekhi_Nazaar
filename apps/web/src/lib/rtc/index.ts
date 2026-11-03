"use client";

import { useEffect, useRef, useState } from "react";
import { RobotStreamConnection } from "./robot-stream";
import type { HubClient, RobotStream } from "./robot-stream";

export type { HubClient, HubMessage, RobotStream } from "./robot-stream";

export function useRobotStream(hub: HubClient | null, opts?: { sendLocal?: MediaStream }): RobotStream {
  const [stream, setStream] = useState<RobotStream>({ remote: null, state: "idle", fallbackFrameUrl: null });
  const local = opts?.sendLocal;
  const connectionRef = useRef<RobotStreamConnection | null>(null);
  useEffect(() => {
    if (!hub) { setStream({ remote: null, state: "idle", fallbackFrameUrl: null }); return; }
    const connection = new RobotStreamConnection(hub, setStream);
    connectionRef.current = connection;
    return () => { connection.close(); connectionRef.current = null; };
  }, [hub]);
  useEffect(() => { connectionRef.current?.setLocal(local); }, [hub, local]);
  return stream;
}
