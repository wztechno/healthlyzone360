import { Gate } from '../../../access/gate.tsx';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { OpsPanel } from '../ops-panel.tsx';

const METRICS = [
    { key: 'openOrders', labelKey: 'kitchen:ops.procurement.metrics.openOrders' },
    { key: 'receipts', labelKey: 'kitchen:ops.procurement.metrics.receipts' },
    { key: 'suppliers', labelKey: 'kitchen:ops.procurement.metrics.suppliers' },
] as const;

export function ProcurementScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-procurement"
        >
            <OpsPanel
                testID="kitchen-procurement-panel"
                titleKey="kitchen:ops.procurement.title"
                subtitleKey="kitchen:ops.procurement.subtitle"
                metrics={METRICS}
                emptyTitleKey="kitchen:ops.procurement.emptyTitle"
                emptyBodyKey="kitchen:ops.procurement.emptyBody"
            />
        </Gate>
    );
}
