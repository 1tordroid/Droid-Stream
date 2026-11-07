/**
 * Programme guide time maths: the grid window, half-hour slots and the cells
 * of one channel row. Pure, so it is unit tested and shared by the screen.
 */

export interface GuideProgramme {
  start: number;
  stop: number;
  title: string;
  desc?: string;
  /** XMLTV catchup-id, for the {catchup-id} placeholder. */
  catchupId?: string;
  /** JioTV programme serial number, needed for Jio catch-up. */
  srno?: string;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const SLOT_MS = 30 * MINUTE;

export const floorSlot = (time: number, slot = SLOT_MS) => Math.floor(time / slot) * slot;

export interface GuideWindow {
  start: number;
  end: number;
}

/** The grid's time range: whole slots from `back` before now to `forward` after it. */
export const guideWindow = (now: number, back: number, forward: number): GuideWindow => ({
  start: floorSlot(now - back),
  end: floorSlot(now + forward) + SLOT_MS,
});

/** Slot start times across the window. */
export const timeSlots = (window: GuideWindow, slot = SLOT_MS): number[] => {
  const slots: number[] = [];
  for (let t = floorSlot(window.start, slot); t < window.end; t += slot) slots.push(t);
  return slots;
};

export type ProgrammeState = 'past' | 'now' | 'future';

export const programmeState = (p: {start: number; stop: number}, now: number): ProgrammeState =>
  p.stop <= now ? 'past' : p.start > now ? 'future' : 'now';

/** Sorted by start, with overlaps trimmed and empty or broken entries dropped. */
export const cleanProgrammes = (list: GuideProgramme[]): GuideProgramme[] => {
  const sorted = list.filter(p => Number.isFinite(p.start) && Number.isFinite(p.stop) && p.stop > p.start).sort((a, b) => a.start - b.start);
  const out: GuideProgramme[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && p.start < last.stop) {
      if (p.start === last.start) continue;
      out[out.length - 1] = {...last, stop: p.start};
    }
    out.push(p);
  }
  return out;
};

/** The programme on air at `time` (list sorted by start), by binary search. */
export const programmeAt = (list: GuideProgramme[], time: number): GuideProgramme | undefined => {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const p = list[mid];
    if (time < p.start) hi = mid - 1;
    else if (time >= p.stop) lo = mid + 1;
    else return p;
  }
  return undefined;
};

export interface GuideCell {
  key: string;
  start: number;
  stop: number;
  /** Pixels from the window start. */
  left: number;
  width: number;
  /** Undefined for a gap with no guide data. */
  programme?: GuideProgramme;
  state: ProgrammeState;
}

/**
 * Cells for one row. Programmes are clipped to the window; gaps become one
 * empty cell per slot, so the D-pad has somewhere to land and "now" can
 * still be picked to play live. Only cells touching `visible` are returned.
 */
export const layoutRow = (
  programmes: GuideProgramme[],
  window: GuideWindow,
  pxPerMs: number,
  now: number,
  visible: GuideWindow = window,
): GuideCell[] => {
  const cells: GuideCell[] = [];
  const from = Math.max(window.start, visible.start);
  const to = Math.min(window.end, visible.end);
  if (to <= from) return cells;
  const push = (start: number, stop: number, programme?: GuideProgramme) => {
    if (stop <= from || start >= to) return;
    cells.push({
      key: `${start}`,
      start,
      stop,
      left: Math.round((start - window.start) * pxPerMs),
      width: Math.max(1, Math.round((stop - window.start) * pxPerMs) - Math.round((start - window.start) * pxPerMs)),
      programme,
      state: programmeState({start, stop}, now),
    });
  };
  const gap = (start: number, stop: number) => {
    let t = start;
    while (t < stop) {
      const next = Math.min(stop, floorSlot(t) + SLOT_MS);
      push(t, next);
      t = next;
    }
  };
  let cursor = window.start;
  // Skip ahead to programmes near the visible range.
  let i = 0;
  while (i < programmes.length && programmes[i].stop <= from) i++;
  if (i > 0) cursor = Math.max(cursor, programmes[i - 1].stop);
  for (; i < programmes.length; i++) {
    const p = programmes[i];
    if (p.start >= to) break;
    const start = Math.max(p.start, window.start);
    const stop = Math.min(p.stop, window.end);
    if (stop <= start) continue;
    if (start > cursor) gap(Math.max(cursor, floorSlot(from)), start);
    push(Math.max(start, cursor), stop, p);
    cursor = Math.max(cursor, stop);
  }
  if (cursor < to) gap(Math.max(cursor, floorSlot(from)), Math.min(window.end, floorSlot(to - 1) + SLOT_MS));
  return cells;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** "18:30" in local time. */
export const formatClock = (time: number) => {
  const d = new Date(time);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const localDay = (time: number) => {
  const d = new Date(time);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** "Today", "Yesterday", "Tomorrow" or "Sat 9 Nov". */
export const dayLabel = (time: number, now: number) => {
  const diff = Math.round((localDay(time) - localDay(now)) / DAY);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  const d = new Date(time);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
