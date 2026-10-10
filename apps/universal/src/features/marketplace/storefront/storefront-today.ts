import type { Kitchen, KitchenDeliveryWindow } from '@healthy360/api-client/contracts';
import { useEffect, useMemo, useState } from 'react';

import { activeBranches, deliveryZones, hoursToday } from '../storefront-facts.ts';

import { latestCutOffToday } from './storefront-menu.ts';

/**
 * The kitchen's own clock, and the day it publishes — what the storefront's "Today in the kitchen"
 * tab and the order panel's cut-off are drawn from.
 *
 * ## What is real here, and what is not
 *
 * HealthZone's tab draws a cook-to-door timeline, live batch progress off the line and a countdown
 * to the lunch cut-off. The public marketplace serves no production data — batches, stations and
 * their progress live behind the kitchen's authenticated production routes — so none of that is
 * drawn. What the kitchen *does* publish is today's opening window, its same-day cut-off and its
 * delivery windows. The timeline is those, in time order; the countdown is the minutes between the
 * kitchen's clock and its published cut-off.
 *
 * ## The kitchen's clock, or none
 *
 * "Now" has to be read in the kitchen's time zone (`KitchenBranch.timeZone`), which needs `Intl`'s
 * `timeZone` option. Hermes does not reliably carry it on Android, and an engine without it may
 * quietly answer in the device's zone instead. So the clock checks that the formatter resolved the
 * zone it was asked for, and returns `null` otherwise — and every caller then states the published
 * times and no live state at all, rather than a countdown measured on the wrong clock.
 */

export interface KitchenClock {
    /** ISO weekday in the kitchen's zone — `1` is Monday. */
    readonly weekday: number;
    /** `HH:mm`, kitchen-local. */
    readonly time: string;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
};

const TWO_DIGITS = /^\d{2}$/;

/** The kitchen-local weekday and time at `now`, or `null` when the zone cannot be resolved. */
export function kitchenClock(timeZone: string | null, now: Date): KitchenClock | null {
    if (timeZone === null || timeZone === '') return null;
    try {
        const format = new Intl.DateTimeFormat('en-US', {
            timeZone,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
        });
        if (format.resolvedOptions().timeZone.toLowerCase() !== timeZone.toLowerCase()) {
            return null;
        }
        const parts = format.formatToParts(now);
        const part = (type: Intl.DateTimeFormatPartTypes) =>
            parts.find((entry) => entry.type === type)?.value;
        const weekday = WEEKDAYS[part('weekday') ?? ''];
        const hour = part('hour');
        const minute = part('minute');
        if (
            weekday === undefined ||
            hour === undefined ||
            minute === undefined ||
            !TWO_DIGITS.test(hour) ||
            !TWO_DIGITS.test(minute)
        ) {
            return null;
        }
        return { weekday, time: `${hour === '24' ? '00' : hour}:${minute}` };
    } catch {
        return null;
    }
}

/** The zone the kitchen's first active branch keeps — the one its published times are read in. */
export function kitchenTimeZone(kitchen: Kitchen): string | null {
    return activeBranches(kitchen)[0]?.timeZone ?? null;
}

/** How often the clock re-reads. A minute's resolution is all the figures it feeds state. */
const TICK_MS = 30_000;

/** The kitchen's clock, re-read every half minute so a countdown does not freeze on screen. */
export function useKitchenClock(timeZone: string | null): {
    readonly clock: KitchenClock | null;
    readonly now: Date;
} {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => {
            setNow(new Date());
        }, TICK_MS);
        return () => {
            clearInterval(id);
        };
    }, []);
    const clock = useMemo(() => kitchenClock(timeZone, now), [timeZone, now]);
    return { clock, now };
}

/** `HH:mm` → minutes after midnight. */
export function toMinutes(time: string): number {
    const [hours = '0', minutes = '0'] = time.split(':');
    return Number(hours) * 60 + Number(minutes);
}

/** Minutes from the clock to `time` — negative once it has passed. */
export function minutesUntil(time: string, clock: KitchenClock): number {
    return toMinutes(time) - toMinutes(clock.time);
}

export type ScheduleKind = 'opens' | 'cutoff' | 'window' | 'closes';
export type ScheduleStatus = 'done' | 'next' | 'todo';

export interface ScheduleEvent {
    readonly key: string;
    readonly kind: ScheduleKind;
    /** `HH:mm`, kitchen-local. */
    readonly time: string;
    /** For a delivery window: the server's own label and its end. */
    readonly window?: KitchenDeliveryWindow | undefined;
}

const KIND_ORDER: Readonly<Record<ScheduleKind, number>> = {
    opens: 0,
    cutoff: 1,
    window: 2,
    closes: 3,
};

/** The delivery windows the kitchen runs on a weekday — an empty `weekdays` means every day. */
export function windowsOn(kitchen: Kitchen, weekday: number): readonly KitchenDeliveryWindow[] {
    return kitchen.deliveryWindows
        .filter((window) => window.weekdays.length === 0 || window.weekdays.includes(weekday))
        .slice()
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * Everything the kitchen publishes about a weekday, in time order: its opening, its same-day
 * cut-off, each delivery window, its closing. Ties keep that order.
 */
export function daySchedule(kitchen: Kitchen, weekday: number): readonly ScheduleEvent[] {
    const hours = hoursToday(kitchen, weekday);
    const cutOff = latestCutOffToday(kitchen, weekday);
    const events: ScheduleEvent[] = [];

    if (hours !== null) events.push({ key: 'opens', kind: 'opens', time: hours.opensAt });
    if (cutOff !== null) events.push({ key: 'cutoff', kind: 'cutoff', time: cutOff });
    for (const window of windowsOn(kitchen, weekday)) {
        events.push({
            key: `window-${window.code}`,
            kind: 'window',
            time: window.startsAt,
            window,
        });
    }
    if (hours !== null) events.push({ key: 'closes', kind: 'closes', time: hours.closesAt });

    return events.sort(
        (a, b) => a.time.localeCompare(b.time) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
    );
}

/**
 * Where each event stands against the kitchen's clock: passed, the next one, or later. Without a
 * clock nothing is passed and nothing is next — the published times are stated and no more.
 */
export function scheduleStatus(
    events: readonly ScheduleEvent[],
    clock: KitchenClock | null,
): readonly ScheduleStatus[] {
    if (clock === null) return events.map(() => 'todo');
    let nextTaken = false;
    return events.map((event) => {
        if (minutesUntil(event.time, clock) <= 0) return 'done';
        if (nextTaken) return 'todo';
        nextTaken = true;
        return 'next';
    });
}

/** The shortest and longest delivery estimate across the kitchen's zones, in minutes. */
export function deliveryMinutesRange(
    kitchen: Kitchen,
): { readonly min: number; readonly max: number } | null {
    const minutes = deliveryZones(kitchen)
        .map((zone) => zone.estimatedMinutes)
        .filter((value): value is number => value !== null);
    return minutes.length === 0 ? null : { min: Math.min(...minutes), max: Math.max(...minutes) };
}

/** Initials for the monogram tile: the first letter of the first two words. */
export function monogram(name: string): string {
    return name
        .trim()
        .split(/\s+/)
        .filter((word) => word !== '')
        .slice(0, 2)
        .map((word) => Array.from(word)[0] ?? '')
        .join('')
        .toLocaleUpperCase();
}
