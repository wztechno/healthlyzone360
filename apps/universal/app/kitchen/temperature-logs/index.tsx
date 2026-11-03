import { lazyScreen } from '../../../src/shell/lazy-screen.tsx';

const TemperatureLogsScreen = lazyScreen(
    'kitchen-temperature-logs-loading',
    async () =>
        (await import('../../../src/features/kitchen-admin/screens/index.ts')).TemperatureLogsScreen,
);

export default function KitchenTemperatureLogs() {
    return <TemperatureLogsScreen />;
}
