import { useEffect, useState } from 'react';

/**
 * A one-second countdown to zero, seeded by the server.
 *
 * Extracted from the pattern `verify-email-screen.tsx` has carried since Phase 4: a `useState` for
 * the remaining seconds and one `setTimeout` per tick. That screen is left alone for now — the OTP
 * panel is a second, denser instance of the same need (a resend cooldown *and* a challenge expiry),
 * and writing the loop a third time is what this exists to stop.
 *
 * ## Why it is seeded rather than started
 *
 * The obvious API is imperative: `start(seconds)` from wherever the server's answer arrives. That
 * shape forces a `setState` inside a `useEffect` when the number arrives as a *prop*, which React's
 * lint rules refuse — correctly, because it is a cascading render. So the seed is the argument, and
 * a change of seed resets the countdown by **derivation** during render: the elapsed count is only
 * trusted while it belongs to the seed it was counted against.
 *
 * The only state write is inside the timeout callback, which is exactly where a tick belongs.
 *
 * ## Why one timeout per tick rather than an interval
 *
 * An interval keeps firing after the component stops caring, and it drifts. One timeout per tick,
 * re-scheduled by the effect's own dependency on the current value, stops by itself at zero: when
 * `seconds` reaches 0 the effect returns early and schedules nothing. That is also what makes the
 * hook safe under a test renderer — there is never a pending timer once the countdown is done.
 */
export interface Countdown {
    /** Seconds remaining. `0` means "no countdown is running". */
    readonly seconds: number;
    readonly running: boolean;
}

interface Ticks {
    /** The seed these ticks were counted against. */
    readonly seed: number;
    readonly elapsed: number;
}

export function useCountdown(seedSeconds: number): Countdown {
    const [ticks, setTicks] = useState<Ticks>({ seed: seedSeconds, elapsed: 0 });

    // A new seed is a new countdown. Derived, not written: nothing here touches state during render.
    const elapsed = ticks.seed === seedSeconds ? ticks.elapsed : 0;
    const seconds = Math.max(0, Math.floor(seedSeconds) - elapsed);

    useEffect(() => {
        if (seconds <= 0) return;
        const timer = setTimeout(() => {
            setTicks((current) => ({
                seed: seedSeconds,
                elapsed: (current.seed === seedSeconds ? current.elapsed : 0) + 1,
            }));
        }, 1000);
        return () => {
            clearTimeout(timer);
        };
    }, [seconds, seedSeconds]);

    return { seconds, running: seconds > 0 };
}

/** Whole seconds between now and an ISO instant, floored at zero. Seeds an expiry countdown. */
export function secondsUntil(isoInstant: string, now: number = Date.now()): number {
    const target = Date.parse(isoInstant);
    if (Number.isNaN(target)) return 0;
    return Math.max(0, Math.ceil((target - now) / 1000));
}
