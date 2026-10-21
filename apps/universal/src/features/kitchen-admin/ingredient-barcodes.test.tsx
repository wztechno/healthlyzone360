import { ApiError, barcodeInvalidFailure } from '@healthy360/api-client';
import type {
    AddIngredientBarcodeRequest,
    IngredientAdmin,
    IngredientBarcode,
} from '@healthy360/api-client/contracts';
import { IngredientId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type * as ReactModule from 'react';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { IngredientBarcodesSection } from './ingredient-barcodes-section.tsx';
import { IngredientBarcodeLabelScreen } from './screens/ingredient-barcode-label-screen.tsx';

/**
 * Ingredient barcodes in the editor and on the label (plan §8).
 *
 * 1. The section lists each code with its origin and pack size, and offers a kitchen code only to
 *    an ingredient that has none.
 * 2. A typed code is linked on Enter, and a refusal is worded by its reason — a wrong digit is not
 *    a weighed-item label.
 * 3. A camera read hands its symbology on with the data, which is how the server knows eight digits
 *    were a UPC-E. The camera itself is mocked: what is under test is the hand-off.
 * 4. The label prints the kitchen code's thirteen digits under the name, as many copies as asked.
 */

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        setParams: jest.fn(),
        back: jest.fn(),
        prefetch: jest.fn(),
    }),
    usePathname: () => '/kitchen/ingredients',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
}));

jest.mock('expo-camera', () => {
    const { useEffect } = jest.requireActual<typeof ReactModule>('react');
    return {
        __esModule: true,
        useCameraPermissions: () => [{ granted: true, canAskAgain: true }, jest.fn()],
        CameraView: ({
            onBarcodeScanned,
        }: {
            onBarcodeScanned: (result: { type: string; data: string }) => void;
        }) => {
            useEffect(() => {
                onBarcodeScanned({ type: 'upc_e', data: '04252614' });
                onBarcodeScanned({ type: 'upc_e', data: '04252614' });
            }, [onBarcodeScanned]);
            return null;
        },
    };
});

const FLOUR = IngredientId.unsafe('01935f6d-0000-7000-8000-0000000000f1');

function barcode(overrides: Partial<IngredientBarcode> = {}): IngredientBarcode {
    return {
        id: 'barcode-1',
        ingredientId: FLOUR,
        gtin: '04006381333931',
        origin: 'supplier',
        packQuantity: '5.0000',
        packUnitCode: 'kg',
        createdAt: null,
        ...overrides,
    };
}

async function press(testID: string) {
    await act(async () => {
        fireEvent.press(screen.getByTestId(testID));
    });
}

describe('the ingredient barcodes section', () => {
    it('lists each code with its origin and pack size, and offers a kitchen code only when there is none', async () => {
        await renderStubScreen(
            <IngredientBarcodesSection ingredientId={FLOUR} defaultUnit="kg" canManage />,
            {
                session: kitchenManagerSession(),
                repositories: { kitchenOps: { listIngredientBarcodes: async () => [barcode()] } },
            },
        );

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-ingredient-barcode-barcode-1')).toBeTruthy();
        });
        expect(screen.getByText(/4006381333931/)).toBeTruthy();
        expect(screen.getByText('Supplier')).toBeTruthy();
        expect(screen.getByText(/One scan = 5/)).toBeTruthy();
        expect(screen.getByTestId('kitchen-ingredient-barcode-generate')).toBeTruthy();
    });

    it('hides "make a kitchen barcode" once the ingredient has one, and offers its label', async () => {
        await renderStubScreen(
            <IngredientBarcodesSection ingredientId={FLOUR} defaultUnit="kg" canManage />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenOps: {
                        listIngredientBarcodes: async () => [
                            barcode({
                                gtin: '00400000000015',
                                origin: 'system',
                                packQuantity: null,
                            }),
                        ],
                    },
                },
            },
        );

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-ingredient-barcode-barcode-1-print')).toBeTruthy();
        });
        expect(screen.getByText('Kitchen')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-ingredient-barcode-generate')).toBeNull();
    });

    it('links a typed code on Enter, and words a refusal by its reason', async () => {
        const sent: AddIngredientBarcodeRequest[] = [];
        await renderStubScreen(
            <IngredientBarcodesSection ingredientId={FLOUR} defaultUnit="kg" canManage />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenOps: {
                        listIngredientBarcodes: async () => [],
                        addIngredientBarcode: async (_id, request) => {
                            sent.push(request);
                            throw new ApiError(barcodeInvalidFailure('check_digit'));
                        },
                    },
                },
            },
        );

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-ingredient-barcodes-empty')).toBeTruthy();
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-ingredient-barcode-code-input'),
                '4006381333932',
            );
        });
        await act(async () => {
            fireEvent(screen.getByTestId('kitchen-ingredient-barcode-code-input'), 'submitEditing');
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-ingredient-barcode-error')).toBeTruthy();
        });
        expect(sent).toEqual([
            expect.objectContaining({ origin: 'supplier', code: '4006381333932', symbology: null }),
        ]);
        expect(screen.getByText(/One of the digits is wrong/)).toBeTruthy();
    });

    it('hands a camera read on with its symbology, once', async () => {
        const sent: AddIngredientBarcodeRequest[] = [];
        await renderStubScreen(
            <IngredientBarcodesSection ingredientId={FLOUR} defaultUnit="kg" canManage />,
            {
                session: kitchenManagerSession(),
                repositories: {
                    kitchenOps: {
                        listIngredientBarcodes: async () => [],
                        addIngredientBarcode: async (_id, request) => {
                            sent.push(request);
                            return barcode({ gtin: '00042100005264', packQuantity: null });
                        },
                    },
                },
            },
        );

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-ingredient-barcode-camera')).toBeTruthy();
        });
        await press('kitchen-ingredient-barcode-camera');

        await waitFor(() => {
            expect(sent).toHaveLength(1);
        });
        expect(sent[0]).toMatchObject({ origin: 'supplier', code: '04252614', symbology: 'upc_e' });
    });
});

describe('the kitchen-code label', () => {
    it('prints the thirteen digits under the name, as many copies as asked', async () => {
        await renderStubScreen(<IngredientBarcodeLabelScreen ingredient={String(FLOUR)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    getIngredient: async () =>
                        ({
                            id: FLOUR,
                            name: { en: 'Basmati rice', ar: 'أرز بسمتي' },
                        }) as unknown as IngredientAdmin,
                },
                kitchenOps: {
                    listIngredientBarcodes: async () => [
                        barcode({ gtin: '00400000000015', origin: 'system', packQuantity: null }),
                    ],
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-ingredient-label-copy-1')).toBeTruthy();
        });
        expect(screen.getByTestId('kitchen-ingredient-label-copy-1-name')).toHaveTextContent(
            'Basmati rice',
        );
        expect(screen.getByTestId('kitchen-ingredient-label-copy-1-digits')).toHaveTextContent(
            /0400000000015/,
        );

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-ingredient-label-copies-input'), '3');
        });
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-ingredient-label-copy-3')).toBeTruthy();
        });
    });

    it('says there is nothing to print for an ingredient without a kitchen code', async () => {
        await renderStubScreen(<IngredientBarcodeLabelScreen ingredient={String(FLOUR)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    getIngredient: async () =>
                        ({
                            id: FLOUR,
                            name: { en: 'Basmati rice', ar: '' },
                        }) as unknown as IngredientAdmin,
                },
                kitchenOps: { listIngredientBarcodes: async () => [barcode()] },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-ingredient-label-nothing')).toBeTruthy();
        });
    });
});
