import { act, fireEvent, renderHook, screen } from '@testing-library/react-native';

import { renderWithI18n } from '../testing/render.tsx';
import { StepProgress } from './step-progress.tsx';
import { useFormSteps } from './use-form-steps.ts';

const FIVE = ['description', 'production', 'packaging', 'costing', 'sheet'] as const;

describe('useFormSteps', () => {
    it('opens on the first step with nothing complete', async () => {
        const { result } = await renderHook(() => useFormSteps(FIVE));

        expect(result.current.current).toBe('description');
        expect(result.current.index).toBe(0);
        expect(result.current.total).toBe(5);
        expect(result.current.isFirst).toBe(true);
        expect(result.current.isLast).toBe(false);
        expect([...result.current.completed]).toEqual([]);
    });

    it('marks a step complete once it is left, in either direction', async () => {
        const { result } = await renderHook(() => useFormSteps(FIVE));

        await act(async () => {
            result.current.next();
        });
        await act(async () => {
            result.current.goTo('costing');
        });
        await act(async () => {
            result.current.previous();
        });

        expect(result.current.current).toBe('packaging');
        expect([...result.current.completed].sort()).toEqual([0, 1, 3]);
    });

    it('ignores a move off either end or onto the open step', async () => {
        const { result } = await renderHook(() => useFormSteps(FIVE));

        await act(async () => {
            result.current.previous();
            result.current.goToIndex(0);
            result.current.goToIndex(9);
        });

        expect(result.current.index).toBe(0);
        expect([...result.current.completed]).toEqual([]);
    });

    it('holds the step by key when the list changes shape around it', async () => {
        const { result, rerender } = await renderHook(
            ({ keys }: { keys: readonly string[] }) => useFormSteps(keys),
            { initialProps: { keys: FIVE as readonly string[] } },
        );

        await act(async () => {
            result.current.goTo('production');
        });
        await act(async () => {
            result.current.goTo('costing');
        });
        // Packaging drops out before the open step: the form stays on Costing, at its new position,
        // and the completed dots follow their steps rather than their old positions.
        await rerender({ keys: FIVE.filter((key) => key !== 'packaging') });

        expect(result.current.current).toBe('costing');
        expect(result.current.index).toBe(2);
        expect([...result.current.completed].sort()).toEqual([0, 1]);
    });

    it('starts again from the opening step', async () => {
        const { result } = await renderHook(() => useFormSteps(FIVE, { initial: 'production' }));

        await act(async () => {
            result.current.next();
        });
        await act(async () => {
            result.current.reset();
        });

        expect(result.current.current).toBe('production');
        expect([...result.current.completed]).toEqual([]);
    });
});

describe('StepProgress', () => {
    const steps = FIVE.map((key, index) => ({
        key,
        label: key,
        testID: `step-${key}`,
        disabled: index > 2,
    }));

    it('will not select a disabled step, and still draws it', async () => {
        const onSelect = jest.fn();
        await renderWithI18n(
            <StepProgress
                label="Steps"
                steps={steps}
                current={2}
                completed={new Set([0, 1])}
                onSelect={onSelect}
            />,
        );

        expect(screen.getByTestId('step-sheet')).toBeDisabled();
        fireEvent.press(screen.getByTestId('step-sheet'));
        expect(onSelect).not.toHaveBeenCalled();

        fireEvent.press(screen.getByTestId('step-description'));
        expect(onSelect).toHaveBeenCalledWith(0);
    });

    it('closes the form opening with a hairline when divided', async () => {
        await renderWithI18n(
            <StepProgress
                testID="divided"
                label="Steps"
                steps={steps}
                current={0}
                completed={new Set()}
                divided
            />,
        );

        expect(screen.getByTestId('divided').props.className).toContain('border-b');
    });
});
