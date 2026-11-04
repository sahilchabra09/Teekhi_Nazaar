export const GAZE_DWELL_MS = 1200;

export type ScreenSample = { x: number; y: number; time: number };

function contains(area: DOMRect, x: number, y: number) {
  return x >= area.left && x < area.right && y >= area.top && y < area.bottom;
}

/** One selection per fixation. Replacing a selected card under a stationary eye
 * must not select the new card (e.g. Appliances → the light in the same slot). */
export class ScreenDwell {
  private current: HTMLElement | null = null;
  private since = 0;
  private lastFrame = -Infinity;
  private previousX = NaN;
  private previousY = NaN;
  private blockedArea: DOMRect | null = null;
  private accepted = false;

  leave() {
    this.current?.dispatchEvent(new Event("gaze:leave"));
    this.current = null;
    this.accepted = false;
  }

  update(element: HTMLElement | null, x: number, y: number, frame: number) {
    if (frame - this.lastFrame > 350 || frame < this.lastFrame) this.leave();
    this.lastFrame = frame;
    const previousX = this.previousX, previousY = this.previousY;
    this.previousX = x;
    this.previousY = y;
    if (this.blockedArea && !contains(this.blockedArea, x, y)) this.blockedArea = null;
    if (element !== this.current) {
      this.leave();
      if (!element || this.blockedArea) return 0;
      if (element.dataset.gazeRequireEntry !== undefined) {
        const area = element.getBoundingClientRect();
        // A call or reply may have replaced the card already under the eye.
        if (contains(area, previousX, previousY)) {
          this.blockedArea = area;
          return 0;
        }
      }
      this.current = element;
      this.since = frame;
      element.dispatchEvent(new Event("gaze:enter"));
    }
    if (!element || this.accepted || !element.isConnected) return 0;
    const dwell = Number(element.dataset.gazeDwell) || GAZE_DWELL_MS;
    const progress = Math.min(1, (frame - this.since) / dwell);
    element.dispatchEvent(new CustomEvent("gaze:progress", { detail: { progress } }));
    if (progress < 1) return progress;
    this.accepted = true;
    this.blockedArea = element.getBoundingClientRect();
    element.dispatchEvent(new Event("gaze:select"));
    return 1;
  }
}
