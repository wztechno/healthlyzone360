import { Gate } from '../../../access/gate.tsx';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { OpsPanel } from '../ops-panel.tsx';

const METRICS = [
    { key: 'openChecks', labelKey: 'kitchen:ops.qc.metrics.openChecks' },
    { key: 'holds', labelKey: 'kitchen:ops.qc.metrics.holds' },
    { key: 'releases', labelKey: 'kitchen:ops.qc.metrics.releases' },
] as const;

export function QualityControlScreen() {
    return (
        <Gate area="kitchen" requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }} testID="kitchen-qc">
            <OpsPanel
                testID="kitchen-qc-panel"
                titleKey="kitchen:ops.qc.title"
                subtitleKey="kitchen:ops.qc.subtitle"
                metrics={METRICS}
                emptyTitleKey="kitchen:ops.qc.emptyTitle"
                emptyBodyKey="kitchen:ops.qc.emptyBody"
            />
        </Gate>
    );
}
