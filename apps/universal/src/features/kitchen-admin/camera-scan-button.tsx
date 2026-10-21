import type { BarcodeScan } from '@healthy360/api-client/contracts';
import { Dialog, Icon, IconButton, Spinner } from '@healthy360/design-system';
import { Suspense, lazy, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Scan with the device's camera (ingredient barcodes, plan §8).
 *
 * The camera module is loaded only when the dialog opens, so a desk user with a keyboard-wedge
 * scanner never downloads it. The dialog closes on the first read and hands `{ data, symbology }` to
 * the same callback the wedge path uses — the wedge path simply has no symbology. On the web the
 * camera needs HTTPS (or localhost).
 *
 * An icon, not a labelled button: it sits inside the barcode field it fills (a `trailing` control)
 * or beside a search box, and a second labelled button in a row of fields is what made the add
 * row read as a pile of controls. Filled brand green wherever it appears, so the scan control is
 * the one thing in the row the eye finds first.
 */
const CameraScanner = lazy(() => import('./camera-scanner.tsx'));

export interface CameraScanButtonProps {
    readonly onScan: (scan: BarcodeScan) => void;
    readonly testID: string;
}

export function CameraScanButton({ onScan, testID }: CameraScanButtonProps) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);

    return (
        <>
            <IconButton
                testID={testID}
                variant="primary"
                size="sm"
                label={t('kitchen:barcodes.camera')}
                icon={<Icon name="scanBarcode" size="md" />}
                onPress={() => {
                    setOpen(true);
                }}
            />
            <Dialog
                testID={`${testID}-dialog`}
                open={open}
                onClose={() => {
                    setOpen(false);
                }}
                title={t('kitchen:barcodes.cameraTitle')}
            >
                {open ? (
                    <Suspense fallback={<Spinner />}>
                        <CameraScanner
                            onScan={(scan) => {
                                setOpen(false);
                                onScan(scan);
                            }}
                        />
                    </Suspense>
                ) : null}
            </Dialog>
        </>
    );
}
