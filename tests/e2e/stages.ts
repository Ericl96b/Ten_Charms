// Which tests can't share the machine. Everything else runs in the parallel stage. Spec files and titles stay as they are.

/** One at a time, but after the parallel stage: they assert a duration, are close to a time limit, or record video. */
export const SERIAL = /recording: |tapping jumps a celebration|choose your phase and sprint|2\. a full match against Pip/;

/** Nothing else may run alongside these: load from other tests would cause false failures. */
export const ALONE = /12\. performance/;

/** Reads the event logs of every other test, so it runs last and means nothing in a partial run. */
export const LAST = /11\. juice coverage/;

/** The safety net against timing bugs that scaled-down waits could hide. One full match is enough, at the largest iPhone size. */
export const REAL_SPEED = /10-real-speed/;

/** Map 2's browser tests, which each carry a timing class in the inventory. */
export const MAP2_FILES = /^1[1-9]-glade/;

/**
 * Map 2 tests that speed up their waits with the setTestScale hook run on a fast clock; all the others run in
 * real time. Performance checks, recordings and image captures must always be real.
 */
export const FAST_CLOCK = /glade: fog layering|glade: no fog|glade: in the fog|glade: the Thorned Crown|glade: the worst-case|glade: both paths|glade: new rewards/;

export function timingOf(title: string): 'real' | 'fast' {
  return FAST_CLOCK.test(title) ? 'fast' : 'real';
}

/** The most that ran clean on the 10-core laptop in TESTING.md. Six caused timeouts and an image difference. Override with TC_WORKERS. */
export const DEFAULT_WORKERS = 4;
