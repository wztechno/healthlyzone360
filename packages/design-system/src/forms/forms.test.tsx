import { fireEvent, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { Text } from '../primitives/text.tsx';
import { assertSubtreeIsLogical, renderWithI18n } from '../testing/render.tsx';
import { Checkbox } from './checkbox.tsx';
import {
    daysInMonth,
    isIsoDate,
    isoFromParts,
    monthNames,
    partsFromIso,
    yearRange,
} from './date-field-shared.ts';
import { DateField } from './date-field.native.tsx';
import { DateField as WebDateField } from './date-field.web.tsx';
import { FormField } from './form-field.tsx';
import { NumberStepper, clampToStep } from './number-stepper.tsx';
import { PasswordInput } from './password-input.tsx';
import { RangeFilter, isInvertedRange } from './range-filter.tsx';
import { Select } from './select.tsx';
import { TextInputField } from './text-input.tsx';

describe('FormField', () => {
    it('links label, hint and error to the control with one describedby chain', async () => {
        await renderWithI18n(
            <FormField
                testID="field"
                id="email"
                label="Email address"
                hint="We only use this to sign you in."
                error="Enter a valid email address."
                required
            >
                {(control) => <Text testID="control" {...control} />}
            </FormField>,
        );

        const control = screen.getByTestId('control');
        expect(control.props.nativeID).toBe('email');
        expect(control.props['aria-labelledby']).toBe('email-label');
        expect(control.props['aria-describedby']).toBe('email-hint email-error');
        expect(control.props['aria-invalid']).toBe(true);
        expect(control.props['aria-required']).toBe(true);
    });

    it('carries the same description as a native hint, so neither platform loses it', async () => {
        await renderWithI18n(
            <FormField testID="field" id="name" label="Full name" hint="As it appears on your ID.">
                {(control) => <Text testID="control" {...control} />}
            </FormField>,
        );
        expect(screen.getByTestId('control').props.accessibilityHint).toBe(
            'As it appears on your ID.',
        );
    });

    it('prefers the error over the hint for the native announcement', async () => {
        await renderWithI18n(
            <FormField testID="field" id="name" label="Full name" hint="A hint." error="A problem.">
                {(control) => <Text testID="control" {...control} />}
            </FormField>,
        );
        expect(screen.getByTestId('control').props.accessibilityHint).toBe('A problem.');
    });

    it('omits describedby entirely when there is nothing to describe', async () => {
        await renderWithI18n(
            <FormField testID="field" id="plain" label="Plain">
                {(control) => <Text testID="control" {...control} />}
            </FormField>,
        );
        const control = screen.getByTestId('control');
        expect(control.props['aria-describedby']).toBeUndefined();
        expect(control.props['aria-invalid']).toBe(false);
    });

    it('announces the error as a live alert, not as silent red text', async () => {
        await renderWithI18n(
            <FormField testID="field" id="email" label="Email" error="Required.">
                {(control) => <Text testID="control" {...control} />}
            </FormField>,
        );
        const error = screen.getByTestId('field-error');
        expect(error.props.accessibilityRole).toBe('alert');
        expect(error).toHaveTextContent('Required.');
    });

    it('marks required fields for sighted users as well as assistive technology', async () => {
        await renderWithI18n(
            <FormField testID="field" id="email" label="Email" required>
                {(control) => <Text testID="control" {...control} />}
            </FormField>,
        );
        expect(screen.getByTestId('field-label')).toHaveTextContent('Email *');
        expect(screen.getByTestId('control').props.accessibilityLabel).toBe('Email *');
    });

    it('generates a stable id when none is supplied', async () => {
        await renderWithI18n(
            <FormField testID="field" label="Email" hint="hint">
                {(control) => <Text testID="control" {...control} />}
            </FormField>,
        );
        const control = screen.getByTestId('control');
        expect(control.props.nativeID).toMatch(/^field-/);
        expect(control.props['aria-describedby']).toBe(`${control.props.nativeID}-hint`);
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <FormField testID="field" label="Email" hint="hint" error="error" required>
                {(control) => <Text testID="control" {...control} />}
            </FormField>,
        );
        assertSubtreeIsLogical(screen.getByTestId('field'));
    });
});

describe('TextInputField', () => {
    it('reports changes and stays logically aligned', async () => {
        const onChangeText = jest.fn();
        await renderWithI18n(
            <TextInputField
                testID="email"
                id="email"
                label="Email address"
                onChangeText={onChangeText}
            />,
        );

        const input = screen.getByTestId('email-input');
        await fireEvent.changeText(input, 'layla@example.com');
        expect(onChangeText).toHaveBeenCalledWith('layla@example.com');
        // React Native's logical alignment: follows the writing direction rather than a side.
        expect(input.props.style).toMatchObject({ textAlign: 'auto' });
    });

    it('marks itself invalid and describes the error', async () => {
        await renderWithI18n(
            <TextInputField testID="email" id="email" label="Email" error="Required." />,
        );
        const input = screen.getByTestId('email-input');
        expect(input.props['aria-invalid']).toBe(true);
        expect(input.props['aria-describedby']).toBe('email-error');
    });

    it('is not editable when disabled', async () => {
        await renderWithI18n(<TextInputField testID="email" label="Email" disabled />);
        expect(screen.getByTestId('email-input').props.editable).toBe(false);
    });

    it('renders Arabic labels without a physical utility', async () => {
        await renderWithI18n(
            <TextInputField testID="email" id="email" label="البريد الإلكتروني" />,
            'ar',
        );
        expect(screen.getByTestId('email-label')).toHaveTextContent('البريد الإلكتروني');
        assertSubtreeIsLogical(screen.getByTestId('email'));
    });
});

describe('PasswordInput', () => {
    it('masks the value and offers a reveal toggle named for its action', async () => {
        await renderWithI18n(<PasswordInput testID="password" id="password" label="Password" />);

        expect(screen.getByTestId('password-input').props.secureTextEntry).toBe(true);
        expect(screen.getByTestId('password-reveal').props.accessibilityLabel).toBe(
            'Show password',
        );
    });

    it('unmasks and renames the toggle when revealed', async () => {
        await renderWithI18n(<PasswordInput testID="password" id="password" label="Password" />);

        await fireEvent.press(screen.getByTestId('password-reveal'));

        expect(screen.getByTestId('password-input').props.secureTextEntry).toBe(false);
        expect(screen.getByTestId('password-reveal').props.accessibilityLabel).toBe(
            'Hide password',
        );
    });

    it('can be built without the toggle for shared-screen step-up prompts', async () => {
        await renderWithI18n(
            <PasswordInput testID="password" id="password" label="Password" revealable={false} />,
        );
        expect(screen.queryByTestId('password-reveal')).toBeNull();
    });

    it('names the toggle in Arabic', async () => {
        await renderWithI18n(
            <PasswordInput testID="password" id="password" label="كلمة المرور" />,
            'ar',
        );
        expect(screen.getByTestId('password-reveal').props.accessibilityLabel).toBe(
            'إظهار كلمة المرور',
        );
    });
});

describe('Checkbox', () => {
    it('exposes a checkbox role with its checked state', async () => {
        await renderWithI18n(
            <Checkbox
                testID="terms"
                id="terms"
                checked={false}
                onChange={jest.fn()}
                label="I accept the terms of service"
                required
            />,
        );
        const control = screen.getByTestId('terms-control');

        expect(control.props.accessibilityRole).toBe('checkbox');
        expect(control.props.accessibilityState).toMatchObject({ checked: false });
        expect(control.props.accessibilityLabel).toBe('I accept the terms of service');
    });

    it('toggles to the opposite value when pressed', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <Checkbox testID="terms" checked={false} onChange={onChange} label="Accept" />,
        );
        await fireEvent.press(screen.getByTestId('terms-control'));
        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('does not toggle when disabled', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <Checkbox testID="terms" checked={false} onChange={onChange} label="Accept" disabled />,
        );
        await fireEvent.press(screen.getByTestId('terms-control'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('shows a check mark only when checked', async () => {
        await renderWithI18n(
            <Checkbox testID="terms" checked onChange={jest.fn()} label="Accept" />,
        );
        expect(screen.getByTestId('terms-box')).toHaveTextContent('✓');
    });

    it('surfaces its error as an alert and describes the control with it', async () => {
        await renderWithI18n(
            <Checkbox
                testID="terms"
                id="terms"
                checked={false}
                onChange={jest.fn()}
                label="Accept"
                error="You must accept the terms of service to continue."
            />,
        );
        expect(screen.getByTestId('terms-error').props.accessibilityRole).toBe('alert');
        expect(screen.getByTestId('terms-control').props['aria-describedby']).toBe('terms-error');
    });
});

describe('Select', () => {
    const options = [
        { value: 'cedar', label: 'Cedar Clinic' },
        { value: 'verdant', label: 'Verdant Kitchen', description: 'Al Quoz' },
        { value: 'closed', label: 'Closed organisation', disabled: true },
    ];

    it('presents the placeholder until something is chosen', async () => {
        await renderWithI18n(
            <Select
                testID="org"
                id="org"
                label="Organisation"
                options={options}
                value={null}
                onChange={jest.fn()}
            />,
        );
        expect(screen.getByTestId('org-value')).toHaveTextContent('Choose an option');
    });

    it('is a collapsed button that names its current value', async () => {
        await renderWithI18n(
            <Select
                testID="org"
                id="org"
                label="Organisation"
                options={options}
                value="cedar"
                onChange={jest.fn()}
            />,
        );
        const trigger = screen.getByTestId('org-trigger');

        expect(trigger.props.accessibilityRole).toBe('button');
        expect(trigger.props.accessibilityLabel).toBe('Organisation: Cedar Clinic');
        expect(trigger.props.accessibilityState).toMatchObject({ expanded: false });
    });

    it('opens a labelled dialog of radio options', async () => {
        await renderWithI18n(
            <Select
                testID="org"
                id="org"
                label="Organisation"
                options={options}
                value={null}
                onChange={jest.fn()}
            />,
        );

        await fireEvent.press(screen.getByTestId('org-trigger'));

        const list = screen.getByTestId('org-list');
        expect(list.props['aria-modal']).toBe(true);
        expect(list.props['aria-labelledby']).toBe('org-dialog-title');

        const option = screen.getByTestId('org-option-cedar');
        expect(option.props.accessibilityRole).toBe('radio');
        expect(option.props.accessibilityState).toMatchObject({ checked: false });
    });

    it('reports the chosen value and closes', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <Select
                testID="org"
                id="org"
                label="Organisation"
                options={options}
                value={null}
                onChange={onChange}
            />,
        );

        await fireEvent.press(screen.getByTestId('org-trigger'));
        await fireEvent.press(screen.getByTestId('org-option-verdant'));

        expect(onChange).toHaveBeenCalledWith('verdant');
        expect(screen.getByTestId('org-trigger').props.accessibilityState).toMatchObject({
            expanded: false,
        });
    });

    it('marks the selected option checked', async () => {
        await renderWithI18n(
            <Select
                testID="org"
                id="org"
                label="Organisation"
                options={options}
                value="verdant"
                onChange={jest.fn()}
            />,
        );
        await fireEvent.press(screen.getByTestId('org-trigger'));
        expect(screen.getByTestId('org-option-verdant').props.accessibilityState).toMatchObject({
            checked: true,
        });
    });

    it('does not choose a disabled option', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <Select
                testID="org"
                id="org"
                label="Organisation"
                options={options}
                value={null}
                onChange={onChange}
            />,
        );
        await fireEvent.press(screen.getByTestId('org-trigger'));
        await fireEvent.press(screen.getByTestId('org-option-closed'));
        expect(onChange).not.toHaveBeenCalled();
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <Select
                testID="org"
                id="org"
                label="المؤسسة"
                options={options}
                value="cedar"
                onChange={jest.fn()}
            />,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('org'));
    });

    describe('searchable', () => {
        /** The prop is additive: without it the dialog is exactly the dialog it always was. */
        it('adds nothing at all unless asked for', async () => {
            await renderWithI18n(
                <Select
                    testID="org"
                    id="org"
                    label="Organisation"
                    options={options}
                    value={null}
                    onChange={jest.fn()}
                />,
            );
            await fireEvent.press(screen.getByTestId('org-trigger'));

            expect(screen.queryByTestId('org-search')).toBeNull();
            expect(screen.queryByTestId('org-search-status')).toBeNull();
            expect(screen.queryByTestId('org-no-results')).toBeNull();
        });

        it('keeps the radio group rather than becoming a combobox', async () => {
            await renderWithI18n(
                <Select
                    testID="org"
                    id="org"
                    label="Organisation"
                    options={options}
                    value={null}
                    onChange={jest.fn()}
                    searchable
                />,
            );
            await fireEvent.press(screen.getByTestId('org-trigger'));

            expect(screen.getByTestId('org-option-cedar').props.accessibilityRole).toBe('radio');
            // A real `<label for>` on the web, which is what axe resolves the name from.
            expect(screen.getByTestId('org-search-label')).toHaveTextContent('Filter the options');
        });

        it('narrows the list to a case-insensitive match on the label', async () => {
            await renderWithI18n(
                <Select
                    testID="org"
                    id="org"
                    label="Organisation"
                    options={options}
                    value={null}
                    onChange={jest.fn()}
                    searchable
                />,
            );
            await fireEvent.press(screen.getByTestId('org-trigger'));
            await fireEvent.changeText(screen.getByTestId('org-search-input'), 'VERD');

            expect(screen.getByTestId('org-option-verdant')).toBeTruthy();
            expect(screen.queryByTestId('org-option-cedar')).toBeNull();
            expect(screen.queryByTestId('org-no-results')).toBeNull();
        });

        it('matches the description as well, because that is text the reader can see', async () => {
            await renderWithI18n(
                <Select
                    testID="org"
                    id="org"
                    label="Organisation"
                    options={options}
                    value={null}
                    onChange={jest.fn()}
                    searchable
                />,
            );
            await fireEvent.press(screen.getByTestId('org-trigger'));
            await fireEvent.changeText(screen.getByTestId('org-search-input'), 'quoz');

            expect(screen.getByTestId('org-option-verdant')).toBeTruthy();
            expect(screen.queryByTestId('org-option-closed')).toBeNull();
        });

        /** A list that silently shrinks is a list a screen reader user never learns about. */
        it('announces the remaining count in a polite live region', async () => {
            await renderWithI18n(
                <Select
                    testID="org"
                    id="org"
                    label="Organisation"
                    options={options}
                    value={null}
                    onChange={jest.fn()}
                    searchable
                />,
            );
            await fireEvent.press(screen.getByTestId('org-trigger'));

            // Mounted *before* anything changes, which is the only way a live region announces.
            const status = screen.getByTestId('org-search-status');
            expect(status.props['aria-live']).toBe('polite');
            expect(status.props.role).toBe('status');

            await fireEvent.changeText(screen.getByTestId('org-search-input'), 'cl');
            expect(screen.getByTestId('org-search-status')).toHaveTextContent('2 matching options');

            await fireEvent.changeText(screen.getByTestId('org-search-input'), 'cedar');
            expect(screen.getByTestId('org-search-status')).toHaveTextContent('1 matching option');
        });

        it('shows a translated line instead of an empty box when nothing matches', async () => {
            await renderWithI18n(
                <Select
                    testID="org"
                    id="org"
                    label="Organisation"
                    options={options}
                    value={null}
                    onChange={jest.fn()}
                    searchable
                />,
            );
            await fireEvent.press(screen.getByTestId('org-trigger'));
            await fireEvent.changeText(screen.getByTestId('org-search-input'), 'zzzz');

            expect(screen.queryByTestId('org-option-cedar')).toBeNull();
            expect(screen.getByTestId('org-no-results')).toHaveTextContent(
                'No option matches your search.',
            );
            expect(screen.getByTestId('org-search-status')).toHaveTextContent(
                'No option matches your search.',
            );
        });

        it('reopens unfiltered, so a stale search cannot hide an option', async () => {
            await renderWithI18n(
                <Select
                    testID="org"
                    id="org"
                    label="Organisation"
                    options={options}
                    value={null}
                    onChange={jest.fn()}
                    searchable
                />,
            );

            await fireEvent.press(screen.getByTestId('org-trigger'));
            await fireEvent.changeText(screen.getByTestId('org-search-input'), 'verdant');
            expect(screen.queryByTestId('org-option-cedar')).toBeNull();

            await fireEvent.press(screen.getByTestId('org-close'));
            await fireEvent.press(screen.getByTestId('org-trigger'));

            expect(screen.getByTestId('org-search-input').props.value).toBe('');
            expect(screen.getByTestId('org-option-cedar')).toBeTruthy();
        });

        it('still reports the chosen value from a filtered list', async () => {
            const onChange = jest.fn();
            await renderWithI18n(
                <Select
                    testID="org"
                    id="org"
                    label="Organisation"
                    options={options}
                    value={null}
                    onChange={onChange}
                    searchable
                />,
            );
            await fireEvent.press(screen.getByTestId('org-trigger'));
            await fireEvent.changeText(screen.getByTestId('org-search-input'), 'verd');
            await fireEvent.press(screen.getByTestId('org-option-verdant'));

            expect(onChange).toHaveBeenCalledWith('verdant');
        });

        it('translates the filter and its empty result', async () => {
            await renderWithI18n(
                <Select
                    testID="org"
                    id="org"
                    label="المؤسسة"
                    options={options}
                    value={null}
                    onChange={jest.fn()}
                    searchable
                />,
                'ar',
            );
            await fireEvent.press(screen.getByTestId('org-trigger'));
            expect(screen.getByTestId('org-search-label')).toHaveTextContent('تصفية الخيارات');

            await fireEvent.changeText(screen.getByTestId('org-search-input'), 'zzzz');
            expect(screen.getByTestId('org-no-results')).toHaveTextContent(
                'لا يوجد خيار يطابق بحثك.',
            );
            assertSubtreeIsLogical(screen.getByTestId('org-list'));
        });
    });
});

describe('clampToStep', () => {
    it('snaps to the nearest step measured from the lower bound', () => {
        expect(clampToStep(37, { min: 0, max: 100, step: 5 })).toBe(35);
        expect(clampToStep(38, { min: 0, max: 100, step: 5 })).toBe(40);
        expect(clampToStep(37, { min: 1, max: 100, step: 5 })).toBe(36);
    });

    it('clamps to the bounds after snapping', () => {
        expect(clampToStep(-40, { min: 0, max: 100, step: 5 })).toBe(0);
        expect(clampToStep(400, { min: 0, max: 100, step: 5 })).toBe(100);
    });

    it('keeps a fractional step free of floating-point dust', () => {
        expect(clampToStep(0.30000000000000004, { min: 0, step: 0.1 })).toBe(0.3);
    });
});

describe('NumberStepper', () => {
    it('announces itself as a spinbutton carrying its own bounds', async () => {
        await renderWithI18n(
            <NumberStepper
                testID="portion"
                id="portion"
                label="Portion size"
                value={2}
                min={1}
                max={6}
                onChange={jest.fn()}
            />,
        );

        const input = screen.getByTestId('portion-input');
        expect(input.props.role).toBe('spinbutton');
        expect(input.props.accessibilityValue).toMatchObject({ now: 2, min: 1, max: 6 });
    });

    it('increments and decrements by the step', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <NumberStepper
                testID="calories"
                id="calories"
                label="Calories"
                value={500}
                step={50}
                onChange={onChange}
            />,
        );

        await fireEvent.press(screen.getByTestId('calories-increment'));
        expect(onChange).toHaveBeenLastCalledWith(550);

        await fireEvent.press(screen.getByTestId('calories-decrement'));
        expect(onChange).toHaveBeenLastCalledWith(450);
    });

    /** Both buttons are 44 dp, which is the reason this replaced a drag rail. */
    it('gives both controls a 44 dp target and a translated name', async () => {
        await renderWithI18n(
            <NumberStepper
                testID="portion"
                id="portion"
                label="Portion size"
                value={2}
                onChange={jest.fn()}
            />,
        );

        const increment = screen.getByTestId('portion-increment');
        expect(increment.props.className).toContain('min-h-touch');
        expect(increment.props.className).toContain('min-w-touch');
        expect(increment.props.accessibilityLabel).toBe('Increase Portion size');
        expect(screen.getByTestId('portion-decrement').props.accessibilityLabel).toBe(
            'Decrease Portion size',
        );
    });

    it('disables the control that would leave the range', async () => {
        await renderWithI18n(
            <NumberStepper
                testID="portion"
                id="portion"
                label="Portion size"
                value={1}
                min={1}
                max={6}
                onChange={jest.fn()}
            />,
        );

        expect(screen.getByTestId('portion-decrement').props.accessibilityState).toMatchObject({
            disabled: true,
        });
        expect(screen.getByTestId('portion-increment').props.accessibilityState).toMatchObject({
            disabled: false,
        });
    });

    it('accepts a typed number and reports an emptied field as unanswered', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <NumberStepper
                testID="calories"
                id="calories"
                label="Calories"
                value={500}
                onChange={onChange}
            />,
        );

        await fireEvent.changeText(screen.getByTestId('calories-input'), '640');
        expect(onChange).toHaveBeenLastCalledWith(640);

        await fireEvent.changeText(screen.getByTestId('calories-input'), '');
        expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it('snaps a typed value back into the range when the field is left', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <NumberStepper
                testID="calories"
                id="calories"
                label="Calories"
                value={9999}
                min={200}
                max={1200}
                step={50}
                onChange={onChange}
            />,
        );

        await fireEvent(screen.getByTestId('calories-input'), 'blur');
        expect(onChange).toHaveBeenLastCalledWith(1200);
    });

    it('is keyboard-operable with the arrow keys on the web', async () => {
        jest.replaceProperty(Platform, 'OS', 'web');
        const onChange = jest.fn();
        await renderWithI18n(
            <NumberStepper
                testID="calories"
                id="calories"
                label="Calories"
                value={500}
                step={50}
                onChange={onChange}
            />,
        );

        const handler = screen.getByTestId('calories-input').props.onKeyDown as (event: {
            key: string;
            preventDefault: () => void;
        }) => void;
        handler({ key: 'ArrowUp', preventDefault: () => undefined });
        expect(onChange).toHaveBeenLastCalledWith(550);

        handler({ key: 'ArrowDown', preventDefault: () => undefined });
        expect(onChange).toHaveBeenLastCalledWith(450);
    });

    it('shows its unit without announcing it twice', async () => {
        await renderWithI18n(
            <NumberStepper
                testID="protein"
                id="protein"
                label="Protein"
                value={30}
                unit="g"
                onChange={jest.fn()}
            />,
        );

        expect(screen.getByTestId('protein-unit')).toHaveTextContent('g');
        expect(screen.getByTestId('protein-unit').props['aria-hidden']).toBe(true);
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <NumberStepper
                testID="portion"
                id="portion"
                label="حجم الحصة"
                value={2}
                onChange={jest.fn()}
            />,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('portion'));
    });
});

describe('RangeFilter', () => {
    it('is a labelled group of two numeric fields, not a drag rail', async () => {
        await renderWithI18n(
            <RangeFilter
                testID="calories"
                id="calories"
                label="Calories per meal"
                value={{ min: 300, max: 700 }}
                onChange={jest.fn()}
            />,
        );

        expect(screen.getByTestId('calories').props.role).toBe('group');
        expect(screen.getByTestId('calories-label')).toHaveTextContent('Calories per meal');
        expect(screen.getByTestId('calories-min-input')).toBeTruthy();
        expect(screen.getByTestId('calories-max-input')).toBeTruthy();
    });

    it('reports each end independently', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <RangeFilter
                testID="calories"
                id="calories"
                label="Calories per meal"
                value={{ min: 300, max: 700 }}
                step={50}
                onChange={onChange}
            />,
        );

        await fireEvent.press(screen.getByTestId('calories-min-increment'));
        expect(onChange).toHaveBeenLastCalledWith({ min: 350, max: 700 });

        await fireEvent.press(screen.getByTestId('calories-max-decrement'));
        expect(onChange).toHaveBeenLastCalledWith({ min: 300, max: 650 });
    });

    /** Swapping the numbers behind the user loses the value they were part-way through typing. */
    it('reports a crossed range rather than silently correcting it', async () => {
        await renderWithI18n(
            <RangeFilter
                testID="calories"
                id="calories"
                label="Calories per meal"
                value={{ min: 900, max: 300 }}
                onChange={jest.fn()}
            />,
        );

        const error = screen.getByTestId('calories-error');
        expect(error.props.accessibilityRole).toBe('alert');
        expect(error).toHaveTextContent('The lower value cannot be greater than the upper value.');
    });

    it('treats a half-filled range as valid', () => {
        expect(isInvertedRange({ min: 900, max: null })).toBe(false);
        expect(isInvertedRange({ min: null, max: 300 })).toBe(false);
        expect(isInvertedRange({ min: 900, max: 300 })).toBe(true);
        expect(isInvertedRange({ min: 300, max: 300 })).toBe(false);
    });

    it('translates its default end labels', async () => {
        await renderWithI18n(
            <RangeFilter
                testID="calories"
                id="calories"
                label="السعرات"
                value={{ min: null, max: null }}
                onChange={jest.fn()}
            />,
            'ar',
        );

        expect(screen.getByTestId('calories-min-label')).toHaveTextContent('من');
        expect(screen.getByTestId('calories-max-label')).toHaveTextContent('إلى');
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <RangeFilter
                testID="calories"
                id="calories"
                label="السعرات"
                value={{ min: 300, max: 700 }}
                onChange={jest.fn()}
            />,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('calories'));
    });
});

describe('DateField — shared arithmetic', () => {
    it('accepts only real calendar dates', () => {
        expect(isIsoDate('2026-02-28')).toBe(true);
        expect(isIsoDate('2024-02-29')).toBe(true);
        expect(isIsoDate('2026-02-29')).toBe(false);
        expect(isIsoDate('2026-13-01')).toBe(false);
        expect(isIsoDate('28-02-2026')).toBe(false);
    });

    it('applies the full leap-year rule, including the century exception', () => {
        expect(daysInMonth(2024, 2)).toBe(29);
        expect(daysInMonth(2100, 2)).toBe(28);
        expect(daysInMonth(2000, 2)).toBe(29);
        expect(daysInMonth(2026, 4)).toBe(30);
    });

    /** A silent roll-over is how a birth date ends up one day out. */
    it('refuses to roll a non-existent day over into the next month', () => {
        expect(isoFromParts({ year: 2026, month: 2, day: 31 })).toBeNull();
        expect(isoFromParts({ year: 2026, month: 2, day: 28 })).toBe('2026-02-28');
        expect(isoFromParts({ year: 2026, month: null, day: 3 })).toBeNull();
    });

    it('reads parts back out of an ISO date', () => {
        expect(partsFromIso('2026-08-03')).toEqual({ year: 2026, month: 8, day: 3 });
        expect(partsFromIso(null)).toEqual({ year: null, month: null, day: null });
        expect(partsFromIso('nonsense')).toEqual({ year: null, month: null, day: null });
    });

    it('derives the offered years from the bounds when it has them', () => {
        const years = yearRange('2020-01-01', '2024-12-31');
        expect(years[0]).toBe(2024);
        expect(years.at(-1)).toBe(2020);
        expect(years).toHaveLength(5);
    });

    it('falls back to month numbers when the engine has no locale data', () => {
        expect(monthNames('en')).toHaveLength(12);
        expect(monthNames('ar')).toHaveLength(12);
    });
});

describe('DateField — native (three selects)', () => {
    it('is a labelled group of day, month and year', async () => {
        await renderWithI18n(
            <DateField
                testID="start"
                id="start"
                label="Start date"
                value="2026-08-03"
                onChange={jest.fn()}
            />,
        );

        expect(screen.getByTestId('start').props.role).toBe('group');
        expect(screen.getByTestId('start-day-value')).toHaveTextContent('3');
        expect(screen.getByTestId('start-year-value')).toHaveTextContent('2026');
    });

    it('offers only the days that exist in the chosen month', async () => {
        await renderWithI18n(
            <DateField
                testID="start"
                id="start"
                label="Start date"
                value="2026-02-10"
                onChange={jest.fn()}
            />,
        );

        await fireEvent.press(screen.getByTestId('start-day-trigger'));
        expect(screen.getByTestId('start-day-option-28')).toBeTruthy();
        expect(screen.queryByTestId('start-day-option-29')).toBeNull();
    });

    it('emits an ISO date when every part is answered', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <DateField
                testID="start"
                id="start"
                label="Start date"
                value="2026-08-03"
                onChange={onChange}
            />,
        );

        await fireEvent.press(screen.getByTestId('start-day-trigger'));
        await fireEvent.press(screen.getByTestId('start-day-option-14'));
        expect(onChange).toHaveBeenLastCalledWith('2026-08-14');
    });

    it('clamps an out-of-bounds choice back into the permitted window', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <DateField
                testID="start"
                id="start"
                label="Start date"
                value="2026-08-20"
                min="2026-08-01"
                max="2026-08-15"
                onChange={onChange}
            />,
        );

        await fireEvent.press(screen.getByTestId('start-day-trigger'));
        await fireEvent.press(screen.getByTestId('start-day-option-25'));
        expect(onChange).toHaveBeenLastCalledWith('2026-08-15');
    });

    it('translates its part labels', async () => {
        await renderWithI18n(
            <DateField
                testID="start"
                id="start"
                label="تاريخ البدء"
                value={null}
                onChange={jest.fn()}
            />,
            'ar',
        );

        expect(screen.getByTestId('start-day-trigger').props.accessibilityLabel).toContain('اليوم');
        expect(screen.getByTestId('start-year-trigger').props.accessibilityLabel).toContain(
            'السنة',
        );
    });

    it('uses no physical direction utility anywhere in its tree', async () => {
        await renderWithI18n(
            <DateField
                testID="start"
                id="start"
                label="تاريخ البدء"
                value="2026-08-03"
                onChange={jest.fn()}
            />,
            'ar',
        );
        assertSubtreeIsLogical(screen.getByTestId('start'));
    });
});

/**
 * Walks the rendered tree for a host element of a given type. The web `DateField` renders a real
 * DOM `input`, which react-test-renderer records as a plain host node — there is no `testID` query
 * for it, and adding one would put a stray attribute on a real browser element.
 */
function findHostByType(node: unknown, type: string): { props: Record<string, unknown> } | null {
    if (node === null || typeof node !== 'object') return null;
    const candidate = node as {
        type?: unknown;
        props?: Record<string, unknown>;
        children?: readonly unknown[] | null;
    };
    if (candidate.type === type) return { props: candidate.props ?? {} };
    for (const child of candidate.children ?? []) {
        const found = findHostByType(child, type);
        if (found !== null) return found;
    }
    return null;
}

function dateInput(): Record<string, unknown> {
    const found = findHostByType(screen.toJSON(), 'input');
    expect(found).not.toBeNull();
    return found!.props;
}

describe('DateField — web (native date input)', () => {
    /**
     * The web half is imported explicitly: jest-expo resolves the platform files as iOS, so
     * `./date-field` would give us the three-select variant. This is the only way to hold the
     * browser implementation to the same props contract.
     */
    it('renders a real date input wired to the field label', async () => {
        await renderWithI18n(
            <WebDateField
                testID="start"
                id="start"
                label="Start date"
                value="2026-08-03"
                min="2026-08-01"
                max="2026-12-31"
                onChange={jest.fn()}
            />,
        );

        const input = dateInput();
        expect(input['type']).toBe('date');
        expect(input['id']).toBe('start');
        expect(input['aria-labelledby']).toBe('start-label');
        expect(input['value']).toBe('2026-08-03');
        expect(input['min']).toBe('2026-08-01');
        expect(input['max']).toBe('2026-12-31');
    });

    it('reports a cleared input as unanswered', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <WebDateField
                testID="start"
                id="start"
                label="Start date"
                value="2026-08-03"
                onChange={onChange}
            />,
        );

        const onDomChange = dateInput()['onChange'] as (event: {
            target: { value: string };
        }) => void;
        onDomChange({ target: { value: '' } });
        expect(onChange).toHaveBeenCalledWith(null);
    });

    it('clamps a value the browser allowed past the bounds', async () => {
        const onChange = jest.fn();
        await renderWithI18n(
            <WebDateField
                testID="start"
                id="start"
                label="Start date"
                value="2026-08-03"
                min="2026-08-01"
                max="2026-08-15"
                onChange={onChange}
            />,
        );

        const onDomChange = dateInput()['onChange'] as (event: {
            target: { value: string };
        }) => void;
        onDomChange({ target: { value: '2026-09-30' } });
        expect(onChange).toHaveBeenCalledWith('2026-08-15');
    });
});
