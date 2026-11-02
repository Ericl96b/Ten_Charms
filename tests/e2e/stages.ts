// Which tests can't share the machine. Everything else runs in the parallel stage. Spec files and titles stay as they are.

/** One at a time, but after the parallel stage: they assert a duration, are close to a time limit, or record video. */
export const SERIAL = /recording: |tapping jumps a celebration|choose your phase and sprint|2\. a full match against Pip/;

/** Nothing else may run alongside these: load from other tests would cause false failures. */
export const ALONE = /12\. performance/;

/** Reads the event logs of every other test, so it runs last and means nothing in a partial run. */
export const LAST = /11\. juice coverage/;

/** The most that ran clean on the 10-core laptop in TESTING.md. Six caused timeouts and an image difference. Override with TC_WORKERS. */
export const DEFAULT_WORKERS = 4;
