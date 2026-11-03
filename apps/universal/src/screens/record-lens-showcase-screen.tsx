import { Badge, Button, Cascade, DensityProvider, Text } from '@healthy360/design-system';
import { View } from 'react-native';

import { RecordLens } from '../features/kitchen-admin/catalogue/record-lens.tsx';
import type {
    RecordLensFact,
    RecordLensFigure,
    RecordLensStep,
} from '../features/kitchen-admin/catalogue/record-lens.tsx';

const DASH = '—';

const RECORD: readonly RecordLensFact[] = [
    { key: 'lot', label: 'Lot', value: 0, display: '261012-001-7' },
    { key: 'made', label: 'Made on', value: 0, display: 'Oct 12, 2026' },
    { key: 'use-by', label: 'Use by', value: 0, display: 'Oct 17, 2026' },
    { key: 'stored', label: 'Stored in', value: 0, display: DASH },
];

const COST: readonly RecordLensFact[] = [
    { key: 'estimated', label: 'Estimated cost', value: 0, display: DASH, separated: true },
    { key: 'actual', label: 'Actual cost', value: 0, display: DASH },
    {
        key: 'unit',
        label: 'Cost per unit',
        value: 1,
        display: 'Withheld',
        tone: 'warning',
        info: 'Salt carried no moving average.',
    },
];

const outcome = (made: boolean): readonly RecordLensFigure[] => [
    { key: 'planned', label: 'Planned', value: '1 kg' },
    { key: 'runs', label: 'Runs', value: '×0.685' },
    { key: 'produced', label: 'Produced', value: made ? '1 kg' : DASH, empty: !made },
    { key: 'rejected', label: 'Rejected', value: made ? '0 kg' : DASH, empty: !made },
    { key: 'variance', label: 'Variance', value: made ? '0 kg' : DASH, empty: !made },
    {
        key: 'usable',
        label: 'Usable',
        value: made ? '1 kg' : DASH,
        empty: !made,
        tone: 'brand',
        separated: true,
    },
];

const history = (started: boolean, completed: boolean): readonly RecordLensStep[] => [
    { key: 'confirmed', label: 'Confirmed', at: started ? 'Oct 12, 2026, 2:07 PM' : null },
    { key: 'started', label: 'Started', at: started ? '2:09 PM' : null },
    { key: 'completed', label: 'Completed', at: completed ? '10:12 PM' : null },
];

/**
 * `/showcase-record-lens` — the Record lens on its own page, as the user asks for redesign parts:
 * the production batch page's one box, finished, in production and as a draft with a short shelf.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */
export function RecordLensShowcaseScreen() {
    return (
        <DensityProvider value="compact">
            <View className="mx-auto w-full max-w-[1280px] p-6">
                <Cascade space="lg" testID="record-lens-showcase">
                    <Text variant="title">Record lens</Text>

                    <RecordLens
                        testID="record-lens-showcase-completed"
                        label="Batch summary"
                        noValue={DASH}
                        heading={
                            <>
                                <Badge tone="success" label="Completed" />
                                <Text variant="strong">Barbecue Dip</Text>
                            </>
                        }
                        steps={history(true, true)}
                        stepsLabel="History"
                        actions={
                            <>
                                <Button size="sm" variant="secondary" label="Technical sheet" />
                                <Button size="sm" variant="secondary" label="Print label" />
                            </>
                        }
                        figures={outcome(true)}
                        facts={[...RECORD, ...COST]}
                    />

                    <RecordLens
                        testID="record-lens-showcase-in-production"
                        label="Batch summary"
                        noValue={DASH}
                        heading={
                            <>
                                <Badge tone="warning" label="In production" />
                                <Text variant="strong">Barbecue Dip</Text>
                            </>
                        }
                        steps={history(true, false)}
                        stepsLabel="History"
                        actions={
                            <>
                                <Button size="sm" variant="secondary" label="Technical sheet" />
                                <Button size="sm" variant="secondary" label="Call it off" />
                                <Button size="sm" variant="danger" label="Abandon" />
                                <Button size="sm" label="Complete" />
                            </>
                        }
                        figures={outcome(false)}
                        note="Second tray in the blast chiller."
                        facts={[
                            ...RECORD.map((fact) => ({ ...fact, display: DASH })),
                            ...COST.slice(0, 2),
                        ]}
                    />

                    <RecordLens
                        testID="record-lens-showcase-draft"
                        label="Batch summary"
                        noValue={DASH}
                        heading={
                            <>
                                <Badge tone="neutral" label="Draft" />
                                <Text variant="strong">Classic Sauce</Text>
                            </>
                        }
                        steps={history(false, false)}
                        stepsLabel="History"
                        actions={
                            <>
                                <Button size="sm" variant="secondary" label="Call it off" />
                                <Button size="sm" label="Confirm" />
                            </>
                        }
                        figures={[
                            { key: 'planned', label: 'Planned', value: '10 kg' },
                            { key: 'runs', label: 'Runs', value: '×3.894' },
                            { key: 'short', label: 'Shelves short', value: '2', tone: 'danger' },
                            ...outcome(false).slice(2),
                        ]}
                        facts={[
                            ...RECORD.map((fact) => ({ ...fact, display: DASH })),
                            {
                                key: 'estimated',
                                label: 'Estimated cost',
                                value: 0,
                                display: 'AED 84.20',
                                separated: true,
                            },
                        ]}
                    />
                </Cascade>
            </View>
        </DensityProvider>
    );
}
