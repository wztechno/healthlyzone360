import type {
    ItemChannelPrices,
    SetItemChannelPricesRequest,
} from '@healthy360/api-client/contracts';
import { MealId, PriceListId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { ChannelPricesSection } from './channel-prices-section.tsx';

/**
 * The B2B / B2C block on an item's page: the v6 sheet's four columns, edited as one pair.
 *
 * What is proven: the saved weights and prices are what the fields open with (a 200 g pack reads
 * as 0.2 kg, $3.00 as 3.00); a save sends only the channel that changed, in minor units; and a
 * kitchen with no B2B price list is told so instead of being handed fields it could not save.
 */

const MEAL = MealId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e1c05');

function prices(overrides: Partial<ItemChannelPrices> = {}): ItemChannelPrices {
    return {
        lockVersion: 4,
        b2b: {
            salesChannelId: 'wholesale',
            priceListId: PriceListId.unsafe('trade-usd'),
            currency: 'USD',
            pack: { quantity: 1, unit: 'kg' },
            amountMinor: 1200,
        },
        b2c: {
            salesChannelId: 'web-shop',
            priceListId: PriceListId.unsafe('retail-usd'),
            currency: 'USD',
            pack: { quantity: 0.2, unit: 'kg' },
            amountMinor: 300,
        },
        ...overrides,
    };
}

describe('ChannelPricesSection', () => {
    it('opens on the saved pair and saves only the channel that changed', async () => {
        const sent: SetItemChannelPricesRequest[] = [];

        await renderStubScreen(<ChannelPricesSection itemId={MEAL} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    getItemChannelPrices: async () => prices(),
                    setItemChannelPrices: async (_itemId, request) => {
                        sent.push(request);
                        return prices({ lockVersion: 5 });
                    },
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-channel-prices-b2c-price-input').props.value).toBe(
                '3.00',
            );
        });
        expect(screen.getByTestId('kitchen-channel-prices-b2c-weight-input').props.value).toBe(
            '0.2',
        );
        expect(screen.getByTestId('kitchen-channel-prices-b2b-price-input').props.value).toBe(
            '12.00',
        );

        await fireEvent.changeText(
            screen.getByTestId('kitchen-channel-prices-b2c-price-input'),
            '3.50',
        );
        await fireEvent.press(screen.getByTestId('kitchen-channel-prices-save'));

        await waitFor(() => {
            expect(sent).toHaveLength(1);
        });
        expect(sent[0]).toEqual({
            lockVersion: 4,
            b2c: { quantity: 0.2, unit: 'kg', amountMinor: 350 },
        });
    });

    it('says there is no B2B price list rather than offering fields it could not save', async () => {
        await renderStubScreen(<ChannelPricesSection itemId={MEAL} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    getItemChannelPrices: async () => prices({ b2b: null }),
                },
            },
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-channel-prices-b2b-unavailable')).toBeTruthy();
        });
        expect(screen.queryByTestId('kitchen-channel-prices-b2b-weight-input')).toBeNull();
    });
});
