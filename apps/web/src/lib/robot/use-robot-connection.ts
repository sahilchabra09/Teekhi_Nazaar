"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createApplicationHub } from "../hub/client";
import type { ApplicationHub, HubState } from "../hub/client";
import { useRobotStream } from "../rtc";
import { idleCamera, SharedCamera } from "./shared-camera";

export function useRobotConnection() {
  const [hub, setHub] = useState<ApplicationHub | null>(null);
  const [status, setStatus] = useState<HubState>("disconnected");
  const [phone, setPhone] = useState(false);
  const [hubError, setHubError] = useState<string | null>(null);
  const activeHub = useRef<ApplicationHub | null>(null);
  const media = useRobotStream(hub);
  const [cameraState, setCameraState] = useState(idleCamera);
  const [camera] = useState(() => new SharedCamera(setCameraState, media.setLocal));

  useEffect(() => {
    camera.restore();
    return () => {
      activeHub.current?.close();
      activeHub.current = null;
      camera.stop();
    };
  }, [camera]);
  useEffect(() => hub?.on("peer_status", (message) => setPhone(message.phone === true)), [hub]);
  useEffect(() => {
    if (status === "unauthorized" || status === "replaced") {
      camera.stop();
      setPhone(false);
    }
  }, [status, camera]);

  const connect = useCallback((address: string) => {
    activeHub.current?.close();
    activeHub.current = null;
    setPhone(false);
    setHubError(null);
    try {
      const next = createApplicationHub(address, setStatus);
      activeHub.current = next;
      setHub(next);
    } catch (cause) {
      setHub(null);
      setStatus("disconnected");
      setHubError(cause instanceof Error ? cause.message : "Could not connect");
    }
  }, []);

  const disconnect = useCallback(() => {
    activeHub.current?.close();
    activeHub.current = null;
    camera.stop();
    setHub(null);
    setPhone(false);
    setHubError(null);
    setStatus("disconnected");
  }, [camera]);

  return {
    hub, status, phone, media, connect, disconnect,
    camera: cameraState.stream, cameraBusy: cameraState.busy, cameraId: cameraState.deviceId,
    cameraError: cameraState.error, error: hubError ?? cameraState.error,
    selectCamera: camera.select, openCamera: camera.open, stopCamera: camera.stop,
  };
}
