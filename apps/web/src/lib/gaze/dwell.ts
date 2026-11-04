export type ScreenSample = { x: number; y: number; time: number };

/** One selection per fixation. Replacing a selected card under a stationary eye
 * must not select the new card (e.g. Appliances → the light in the same slot). */
export class ScreenDwell {
  private current: HTMLElement | null = null;
  private since = 0;
  private lastFrame = -Infinity;
  private selectedArea: DOMRect | null = null;
  private accepted = false;

  leave() {
    this.current?.dispatchEvent(new Event("gaze:leave"));
    this.current = null;
    this.accepted = false;
  }

  update(element: HTMLElement | null, x: number, y: number, frame: number) {
    if (frame - this.lastFrame > 350 || frame < this.lastFrame) this.leave();
    this.lastFrame = frame;
    const area = this.selectedArea;
    if (area && (x < area.left || x >= area.right || y < area.top || y >= area.bottom)) {
      this.selectedArea = null;
    }
    if (element !== this.current) {
      this.leave();
      if (!element || this.selectedArea) return;
      this.current = element;
      this.since = frame;
      element.dispatchEvent(new Event("gaze:enter"));
    }
    if (!element || this.accepted || !element.isConnected) return;
    const dwell = Number(element.dataset.gazeDwell) || 900;
    const progress = Math.min(1, (frame - this.since) / dwell);
    element.dispatchEvent(new CustomEvent("gaze:progress", { detail: { progress } }));
    if (progress < 1) return;
    this.accepted = true;
    this.selectedArea = element.getBoundingClientRect();
    element.dispatchEvent(new Event("gaze:select"));
  }
}
