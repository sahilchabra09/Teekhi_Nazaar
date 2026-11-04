import { expect, test } from "bun:test";
import { ScreenDwell } from "../src/lib/gaze/dwell";

function button(left = 0) {
  const events: string[] = [];
  const target = Object.assign(new EventTarget(), {
    isConnected: true,
    dataset: { gazeDwell: "900" },
    getBoundingClientRect: () => ({ left, right: left + 100, top: 0, bottom: 100 }),
  });
  for (const event of ["enter", "select", "leave"]) {
    target.addEventListener("gaze:" + event, () => events.push(event));
  }
  return { target: target as unknown as HTMLElement, events };
}

test("one continuous fixation selects once, and a new card under the resting eye cannot fire", () => {
  const dwell = new ScreenDwell(), first = button(), replacement = button();
  for (let t = 0; t <= 1200; t += 100) dwell.update(first.target, 50, 50, t);
  expect(first.events).toEqual(["enter", "select"]);
  for (let t = 1300; t <= 2400; t += 100) dwell.update(replacement.target, 50, 50, t);
  expect(first.events.at(-1)).toBe("leave");
  expect(replacement.events).toEqual([]);
  dwell.update(null, 110, 50, 2500);
  for (let t = 2600; t <= 3500; t += 100) dwell.update(replacement.target, 50, 50, t);
  expect(replacement.events).toEqual(["enter", "select"]);
});

test("a stale capture or tracking loss resets incomplete dwell", () => {
  const dwell = new ScreenDwell(), a = button();
  for (const t of [0, 200, 400, 600, 800, 1200, 1400, 1600]) dwell.update(a.target, 50, 50, t);
  dwell.leave();
  for (const t of [1700, 1900, 2100, 2300, 2500]) dwell.update(a.target, 50, 50, t);
  expect(a.events).not.toContain("select");
  dwell.update(a.target, 50, 50, 2600);
  expect(a.events.at(-1)).toBe("select");
});

test("a request replacing a partially dwelled card needs a fresh gaze entry", () => {
  const dwell = new ScreenDwell(), original = button(), request = button();
  request.target.dataset.gazeRequireEntry = "";
  for (const t of [0, 100, 200]) dwell.update(original.target, 50, 50, t);
  for (let t = 300; t <= 1600; t += 100) dwell.update(request.target, 50, 50, t);
  expect(request.events).toEqual([]);
  dwell.update(null, 120, 50, 1700);
  for (let t = 1800; t <= 2800; t += 100) dwell.update(request.target, 50, 50, t);
  expect(request.events).toEqual(["enter", "select"]);
});

test("ordinary card replacements can still start a new dwell at the same position", () => {
  const dwell = new ScreenDwell(), original = button(), replacement = button();
  dwell.update(original.target, 50, 50, 0);
  for (let t = 100; t <= 1100; t += 100) dwell.update(replacement.target, 50, 50, t);
  expect(replacement.events).toEqual(["enter", "select"]);
});
