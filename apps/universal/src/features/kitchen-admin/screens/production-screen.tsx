import { Gate } from '../../../access/gate.tsx';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { OpsPanel } from '../ops-panel.tsx';

const METRICS = [
    { key: 'batches', labelKey: 'kitchen:ops.production.metrics.batches' },
    { key: 'inProgress', labelKey: 'kitchen:ops.production.metrics.inProgress' },
    { key: 'yield', labelKey: 'kitchen:ops.production.metrics.yield' },
] as const;

export function ProductionScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-production"
        >
            <OpsPanel
                testID="kitchen-production-panel"
                titleKey="kitchen:ops.production.title"
                subtitleKey="kitchen:ops.production.subtitle"
                metrics={METRICS}
                emptyTitleKey="kitchen:ops.production.emptyTitle"
                emptyBodyKey="kitchen:ops.production.emptyBody"
            />
        </Gate>
    );
}
