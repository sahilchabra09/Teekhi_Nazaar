"use client";

import { broker, TOPICS } from "./broker";

/**
 * Robot drive commands, agreed with the IoT engineer (docs/controls.md):
 *   {"password":"<robot password>","cmd":"<letter>"}  →  carbot/command, QoS 1, retain=false
 * U/D are new letters the firmware is adding; they are sent as-is (not translated to servo commands).
 * Plain `cmd` messages persist until the next command, so S (stop) matters.
 */
export const ROBOT_COMMANDS = ["U", "F", "S", "B", "D", "L", "R"] as const;
export type RobotCommand = (typeof ROBOT_COMMANDS)[number];

export const COMMAND_LABEL: Record<RobotCommand, string> = {
  U: "Up",
  F: "Forward",
  S: "Stop",
  B: "Back",
  D: "Down",
  L: "Left",
  R: "Right",
};

export function sendRobotCommand(cmd: RobotCommand, password: string) {
  return broker.publish(TOPICS.robotCommand, { password, cmd });
}

/** Safety stop when the feed disappears or the user leaves; nobody can wait for the ack. */
export function stopRobotBestEffort(password: string) {
  if (password) broker.publishBestEffort(TOPICS.robotCommand, { password, cmd: "S" });
}
