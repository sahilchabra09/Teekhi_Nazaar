export type InputKind = "camera" | "microphone";

const storageKeys = { camera: "iris.sharedCameraDeviceId", microphone: "iris.micDeviceId" };

export function readInput(kind: InputKind) {
  try { return localStorage.getItem(storageKeys[kind]) ?? ""; }
  catch { return ""; }
}

export function saveInput(kind: InputKind, deviceId: string) {
  try { localStorage.setItem(storageKeys[kind], deviceId); }
  catch { /* The selection still applies for this session. */ }
}

export function requestInput(constraints: MediaStreamConstraints) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Open the dashboard on HTTPS or localhost to access devices.");
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}

export function inputError(kind: InputKind, cause: unknown) {
  if (cause instanceof Error) {
    switch (cause.name) {
      case "NotAllowedError":
      case "SecurityError":
        return `Allow ${kind} access in your browser’s site settings, then try again.`;
      case "NotFoundError":
      case "OverconstrainedError":
        return `The selected ${kind} is unavailable. Reconnect it or choose another in Settings.`;
      case "NotReadableError":
        return `The ${kind} is busy. Close other apps using it or choose another device.`;
      default:
        return cause.message || `Could not open the ${kind}. Try another device.`;
    }
  }
  return `Could not open the ${kind}. Try another device.`;
}
