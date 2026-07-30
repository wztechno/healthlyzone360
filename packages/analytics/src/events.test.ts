import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { ANALYTICS_EVENT_NAMES, analyticsEvent } from './events.ts';
import type {
    AnalyticsEvent,
    AnalyticsEventName,
    AnalyticsEventOf,
    AnalyticsPrimitive,
    AnalyticsProps,
} from './events.ts';
import { ConsoleAnalytics, NoopAnalytics } from './client.ts';
import type { AnalyticsClient } from './client.ts';

describe('event contract (type level)', () => {
    it('declares exactly the six foundation events', () => {
        expect([...ANALYTICS_EVENT_NAMES]).toEqual([
            'auth.login_submitted',
            'auth.login_succeeded',
            'auth.registration_completed',
            'context.organisation_selected',
            'context.branch_selected',
            'workspace.switched',
        ]);
        expectTypeOf<AnalyticsEventName>().toEqualTypeOf<(typeof ANALYTICS_EVENT_NAMES)[number]>();
    });

    it('types each event’s properties exactly', () => {
        expectTypeOf<AnalyticsEventOf<'context.branch_selected'>['props']>().toEqualTypeOf<{
            readonly branchCount: number;
            readonly wasOnlyOption: boolean;
        }>();

        expectTypeOf<AnalyticsEventOf<'auth.login_submitted'>['props']['method']>().toEqualTypeOf<
            'password' | 'two_factor'
        >();
    });

    it('rejects unknown events, unknown props and wrong prop types at compile time', () => {
        // `@ts-expect-error` only suppresses the line immediately after it, so each directive sits
        // directly above the token that must fail. Placing it above the whole call would break the
        // moment a formatter rewrapped the argument list.
        analyticsEvent(
            // @ts-expect-error unknown event name
            'auth.hacked',
            {},
        );
        analyticsEvent('context.branch_selected', {
            // @ts-expect-error branchCount must be a number
            branchCount: 'two',
            wasOnlyOption: false,
        });
        analyticsEvent('context.branch_selected', {
            branchCount: 2,
            wasOnlyOption: false,
            // @ts-expect-error unknown property `notes` — no free-text payloads
            notes: 'x',
        });
        analyticsEvent('auth.login_submitted', {
            // @ts-expect-error method is a closed union
            method: 'magic_link',
            remember: false,
            mode: 'staff',
        });
        // @ts-expect-error props are required
        analyticsEvent('context.branch_selected');

        expect(true).toBe(true);
    });

    it('forbids non-primitive property values', () => {
        // Every declared event's props must be assignable to the primitive-only record.
        expectTypeOf<AnalyticsEvent['props']>().toExtend<AnalyticsProps>();
        expectTypeOf<AnalyticsPrimitive>().toEqualTypeOf<string | number | boolean | null>();
    });

    it('builds a well-formed event object', () => {
        expect(
            analyticsEvent('workspace.switched', {
                fromArea: null,
                toArea: 'clinic',
                mode: 'staff',
            }),
        ).toEqual({
            name: 'workspace.switched',
            props: { fromArea: null, toArea: 'clinic', mode: 'staff' },
        });
    });
});

describe('NoopAnalytics', () => {
    it('satisfies the client interface and does nothing observable', () => {
        const client: AnalyticsClient = new NoopAnalytics();
        expect(() => {
            client.track(
                analyticsEvent('context.branch_selected', { branchCount: 1, wasOnlyOption: true }),
            );
            client.identify('01935f6c-0000-7000-8000-000000000091');
            client.reset();
        }).not.toThrow();
    });
});

describe('ConsoleAnalytics', () => {
    it('prints events through the injected logger', () => {
        const log = vi.fn();
        const client: AnalyticsClient = new ConsoleAnalytics({ log, prefix: '[test]' });

        client.track(
            analyticsEvent('context.branch_selected', { branchCount: 3, wasOnlyOption: false }),
        );
        client.identify('user-1', { locale: 'ar' });
        client.reset();

        expect(log.mock.calls).toEqual([
            ['[test] context.branch_selected', { branchCount: 3, wasOnlyOption: false }],
            ['[test] identify user-1', { locale: 'ar' }],
            ['[test] reset'],
        ]);
    });

    it('never reaches the network — the module imports nothing but its own types', async () => {
        const module = await import('./client.ts');
        expect(Object.keys(module).sort()).toEqual(['ConsoleAnalytics', 'NoopAnalytics']);
    });
});
