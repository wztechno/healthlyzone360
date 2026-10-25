import { useLocalSearchParams } from 'expo-router';

import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/consumption-exceptions` — the consumption-exception review surface (INV1.5): what
 * confirmed orders could not deduct honestly, with resolve and retry.
 *
 * Behind `inventory.view_organisation` — the screen's own `<Gate>` refuses a reader without it, and
 * the resolve/retry controls need `inventory.manage_organisation`.
 *
 * `?status=`, `?from=`, `?page=`, `?gap=` and `?fixed=` are the view the list was left on
 * (`stock-gap-fix.ts`), so Back from a recipe fix returns to the same gap.
 */
const ConsumptionExceptionsScreen = lazyScreen(
    'kitchen-consumption-exceptions-loading',
    async () =>
        (await import('../../src/features/kitchen-admin/screens/index.ts'))
            .ConsumptionExceptionsScreen,
);

export default function KitchenConsumptionExceptions() {
    const { status, from, page, gap, fixed } = useLocalSearchParams<{
        status?: string;
        from?: string;
        page?: string;
        gap?: string;
        fixed?: string;
    }>();
    return (
        <ConsumptionExceptionsScreen
            status={status}
            from={from}
            page={page}
            gap={gap}
            fixed={fixed}
        />
    );
}
