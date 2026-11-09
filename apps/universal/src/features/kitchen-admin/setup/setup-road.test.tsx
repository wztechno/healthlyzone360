import type { KitchenSetupStep } from '@healthy360/api-client/contracts';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SetupRoad, canDrawRoad, roadProgress } from './setup-road.tsx';

const steps = (done: readonly boolean[]): readonly KitchenSetupStep[] =>
    (['hours', 'delivery', 'menu', 'prices'] as const).map((key, index) => ({
        key,
        required: true,
        done: done[index] === true,
    }));

describe('the road to opening', () => {
    it('runs the green only through the unbroken run of finished steps', () => {
        expect(roadProgress(steps([false, false, false, false]), false)).toBe(0);
        expect(roadProgress(steps([true, true, false, false]), false)).toBe(51);
        // Prices finished out of order does not carry the road past the open Delivery.
        expect(roadProgress(steps([true, false, false, true]), false)).toBe(27);
        expect(roadProgress(steps([true, true, true, true]), false)).toBe(75);
        expect(roadProgress(steps([true, true, true, true]), true)).toBe(100);
    });

    it('draws only the four stops its curve has room for', () => {
        expect(canDrawRoad(steps([]))).toBe(true);
        expect(canDrawRoad(steps([]).slice(0, 3))).toBe(false);
    });

    it('opens a step from its stop, and marks only the finished ones', async () => {
        const onOpen = jest.fn();
        await render(
            <SetupRoad
                steps={steps([true, false, false, false])}
                isLive={false}
                onOpen={onOpen}
                testID="road"
            />,
        );

        expect(screen.getByTestId('road-hours-done')).toBeTruthy();
        expect(screen.queryByTestId('road-delivery-done')).toBeNull();

        fireEvent.press(screen.getByTestId('road-delivery'));

        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'delivery' }));
    });
});
