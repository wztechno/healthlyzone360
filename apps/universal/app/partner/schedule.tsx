import { lazyScreen } from '../../src/shell/lazy-screen.tsx';

/** `/partner/schedule` — the supply days a supplier has to hit, grouped by date. */
const PartnerScheduleScreen = lazyScreen(
    'partner-schedule-loading',
    async () =>
        (await import('../../src/features/business/screens/index.ts')).PartnerScheduleScreen,
);

export default function PartnerSchedule() {
    return <PartnerScheduleScreen />;
}
