import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/**
 * `/kitchen/consumption-exceptions` — the consumption-exception review surface (INV1.5): what
 * confirmed orders could not deduct honestly, with resolve and retry.
 *
 * Behind `inventory.view_organisation` — the screen's own `<Gate>` refuses a reader without it, and
 * the resolve/retry controls need `inventory.manage_organisation`.
 */
const ConsumptionExceptionsScreen = lazyScreen(
    'kitchen-consumption-exceptions-loading',
    async () =>
        (await import('../../src/features/kitchen-admin/screens/index.ts'))
            .ConsumptionExceptionsScreen,
);

export default function KitchenConsumptionExceptions() {
    return <ConsumptionExceptionsScreen />;
}
