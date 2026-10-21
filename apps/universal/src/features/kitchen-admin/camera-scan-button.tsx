import type { BarcodeScan } from '@healthy360/api-client/contracts';
import { Button, Dialog, Spinner } from '@healthy360/design-system';
import { Suspense, lazy, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Scan with the device's camera (ingredient barcodes, plan §8).
 *
 * The camera module is loaded only when the dialog opens, so a desk user with a keyboard-wedge
 * scanner never downloads it. The dialog closes on the first read and hands `{ data, symbology }` to
 * the same callback the wedge path uses — the wedge path simply has no symbology. On the web the
 * camera needs HTTPS (or localhost).
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
            <Button
                testID={testID}
                variant="secondary"
                size="sm"
                label={t('kitchen:barcodes.camera')}
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
