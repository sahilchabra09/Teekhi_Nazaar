"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createApplicationHub } from "../hub/client";
import type { ApplicationHub, HubState } from "../hub/client";
import { useRobotStream } from "../rtc";

export function useRobotConnection() {
  const [hub, setHub] = useState<ApplicationHub | null>(null);
  const [status, setStatus] = useState<HubState>("disconnected");
  const [phone, setPhone] = useState(false);
  const [camera, setCamera] = useState<MediaStream>();
  const [cameraBusy, setCameraBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resources = useRef<{ hub?: ApplicationHub; camera?: MediaStream }>({});
  const epoch = useRef(0);
  const mounted = useRef(true);
  const media = useRobotStream(hub, { sendLocal: camera });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; epoch.current++;
      resources.current.hub?.close();
      resources.current.camera?.getTracks().forEach((track) => track.stop());
      resources.current = {};
    };
  }, []);
  useEffect(() => hub?.on("peer_status", (message) => setPhone(message.phone === true)), [hub]);
  useEffect(() => {
    if (status !== "unauthorized" && status !== "replaced") return;
    epoch.current++;
    resources.current.camera?.getTracks().forEach((track) => track.stop());
    resources.current.camera = undefined; setCamera(undefined); setCameraBusy(false); setPhone(false);
  }, [status]);

  const openCamera = useCallback(async () => {
    if (resources.current.camera?.getVideoTracks().some((track) => track.readyState === "live")) return;
    const generation = epoch.current;
    setCameraBusy(true); setError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Open the console on localhost or HTTPS to share your camera.");
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      if (!mounted.current || epoch.current !== generation) { stream.getTracks().forEach((track) => track.stop()); return; }
      resources.current.camera?.getTracks().forEach((track) => track.stop());
      resources.current.camera = stream; setCamera(stream);
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (mounted.current && resources.current.camera === stream) {
          resources.current.camera = undefined; setCamera(undefined); setError("Your camera stopped. Share it again to restore the phone display.");
        }
      }, { once: true });
    } catch (cause) {
      if (mounted.current && epoch.current === generation) setError(cause instanceof Error ? cause.message : "Camera access was blocked");
    } finally { if (mounted.current && epoch.current === generation) setCameraBusy(false); }
  }, []);

  const connect = useCallback((address: string) => {
    epoch.current++;
    resources.current.hub?.close(); setPhone(false); setError(null);
    try {
      const next = createApplicationHub(address, (value) => { if (mounted.current) setStatus(value); });
      resources.current.hub = next; setHub(next);
      void openCamera();
    } catch (cause) {
      resources.current.hub = undefined; setHub(null); setStatus("disconnected");
      setError(cause instanceof Error ? cause.message : "Could not connect");
    }
  }, [openCamera]);

  const disconnect = useCallback(() => {
    epoch.current++;
    resources.current.hub?.close();
    resources.current.camera?.getTracks().forEach((track) => track.stop());
    resources.current = {}; setHub(null); setCamera(undefined); setPhone(false); setCameraBusy(false); setStatus("disconnected");
  }, []);
  const stopCamera = useCallback(() => {
    epoch.current++; // invalidate a permission request still in flight
    resources.current.camera?.getTracks().forEach((track) => track.stop());
    resources.current.camera = undefined; setCamera(undefined); setCameraBusy(false);
  }, []);
  return { hub, status, phone, camera, cameraBusy, error, media, connect, disconnect, openCamera, stopCamera };
}
