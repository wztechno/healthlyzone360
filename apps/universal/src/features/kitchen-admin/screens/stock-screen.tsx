import { Gate } from '../../../access/gate.tsx';
import { CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { OpsPanel } from '../ops-panel.tsx';

const METRICS = [
    { key: 'onHand', labelKey: 'kitchen:ops.stock.metrics.onHand' },
    { key: 'adjustments', labelKey: 'kitchen:ops.stock.metrics.adjustments' },
    { key: 'waste', labelKey: 'kitchen:ops.stock.metrics.waste' },
] as const;

export function StockScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-stock"
        >
            <OpsPanel
                testID="kitchen-stock-panel"
                titleKey="kitchen:ops.stock.title"
                subtitleKey="kitchen:ops.stock.subtitle"
                metrics={METRICS}
                emptyTitleKey="kitchen:ops.stock.emptyTitle"
                emptyBodyKey="kitchen:ops.stock.emptyBody"
            />
        </Gate>
    );
}
