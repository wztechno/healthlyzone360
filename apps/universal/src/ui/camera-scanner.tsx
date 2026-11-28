import type { BarcodeScan } from '@healthy360/api-client/contracts';
import { Button, Spinner, Stack, Text } from '@healthy360/design-system';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { BarcodeType } from 'expo-camera';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * The camera itself — loaded lazily by `CameraScanButton`, so `expo-camera` stays out of the bundle
 * until somebody asks for it.
 *
 * Reads what packs and kitchen labels carry: EAN-13/8, UPC-A/E, ITF-14 case codes, GS1-128,
 * GS1 DataMatrix and QR (GS1 Digital Link). The first read wins; the symbology goes with it, which
 * is how the server knows eight digits were a UPC-E.
 */
const BARCODE_TYPES: BarcodeType[] = [
    'ean13',
    'ean8',
    'upc_a',
    'upc_e',
    'code128',
    'itf14',
    'datamatrix',
    'qr',
];

export interface CameraScannerProps {
    readonly onScan: (scan: BarcodeScan) => void;
}

export default function CameraScanner({ onScan }: CameraScannerProps) {
    const { t } = useTranslation();
    const [permission, requestPermission] = useCameraPermissions();
    // The camera keeps reporting the same code until it closes; only the first read counts.
    const read = useRef(false);

    if (permission === null) return <Spinner />;

    if (!permission.granted) {
        return (
            <Stack space="sm" testID="kitchen-camera-permission">
                <Text tone="secondary">
                    {t(
                        permission.canAskAgain
                            ? 'kitchen:barcodes.cameraAsk'
                            : 'kitchen:barcodes.cameraBlocked',
                    )}
                </Text>
                {permission.canAskAgain ? (
                    <Button
                        testID="kitchen-camera-allow"
                        size="sm"
                        label={t('kitchen:barcodes.cameraAllow')}
                        onPress={() => {
                            void requestPermission();
                        }}
                    />
                ) : null}
            </Stack>
        );
    }

    return (
        <CameraView
            testID="kitchen-camera-view"
            style={{ width: '100%', aspectRatio: 4 / 3 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
            onBarcodeScanned={(result) => {
                if (read.current) return;
                read.current = true;
                onScan({ data: result.data, symbology: result.type });
            }}
        />
    );
}
