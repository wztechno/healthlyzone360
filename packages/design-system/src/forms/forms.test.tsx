import { fireEvent, screen } from '@testing-library/react-native';

import { Text } from '../primitives/text.tsx';
import { assertSubtreeIsLogical, renderWithI18n } from '../testing/render.tsx';
import { Checkbox } from './checkbox.tsx';
import { FormField } from './form-field.tsx';
import { PasswordInput } from './password-input.tsx';
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
});
