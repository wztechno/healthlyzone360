import type { OverrideVdProposalRequest, VdProposal } from '@healthy360/api-client/contracts';
import { Button, Callout, Dialog, Stack, Text, TextInputField } from '@healthy360/design-system';
import type { MacroTarget } from '@healthy360/nutrition';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Human override of a machine proposal.
 *
 * The contract carries `overriddenAt` and `overriddenBy` separately from `acceptedAt` because
 * "I agreed with the suggestion" and "I replaced the suggestion" are different facts about a person
 * (`contracts/virtual-dietitian.ts`). This dialog produces the second one.
 *
 * ## Why the energy figure is turned into a macro split
 *
 * `OverrideVdProposalRequest` carries `targetEnergy`, `macros` and `mealStructure`, and the
 * prototype store applies the last two. Sending only an energy number would therefore change nothing
 * a screen can display, and a control whose effect is invisible is a control that is lying. So the
 * suggested percentage split is rescaled to the person's energy figure and sent as `macros`, with
 * `targetEnergy` sent alongside for the API repository that will honour it directly. The displayed
 * human-origin energy is then the sum of the macro energies — a figure derived from what was
 * actually stored rather than from what was typed.
 *
 * ## The confirmation states consequences, not merely "are you sure"
 *
 * Three of them, explicitly: the figures become the person's own, nobody qualified has checked them,
 * and planning will follow them. Review remains available afterwards and the dialog says so, because
 * an override that felt irreversible would push people towards accepting a suggestion they disagree
 * with.
 */

/** kcal per gram, by macronutrient. Atwater factors; used only to turn energy back into grams. */
const ENERGY_PER_GRAM: Readonly<Record<string, number>> = {
    protein: 4,
    carbohydrate: 4,
    fat: 9,
};

const MIN_ENERGY = 800;
const MAX_ENERGY = 6000;

/** The energy a set of macro targets actually adds up to. */
export function energyFromMacros(macros: readonly MacroTarget[]): number {
    return Math.round(macros.reduce((total, macro) => total + macro.kilocalories, 0));
}

/** Rescales the proposed split to a new energy figure, keeping every percentage where it was. */
export function rescaleMacros(
    macros: readonly MacroTarget[],
    targetEnergy: number,
): readonly MacroTarget[] {
    return macros.map((macro) => {
        const kilocalories = Math.round((targetEnergy * macro.percentageOfEnergy) / 100);
        const perGram = ENERGY_PER_GRAM[macro.nutrientId] ?? 4;
        return {
            ...macro,
            kilocalories,
            grams: Math.round(kilocalories / perGram),
            gramsPerKilogram: null,
        };
    });
}

export interface OverrideDialogProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly proposal: VdProposal;
    readonly onConfirm: (request: OverrideVdProposalRequest) => void;
    readonly applying: boolean;
    readonly failure: string | null;
}

export const VD_OVERRIDE_DIALOG_TEST_ID = 'vd-override-dialog';

export function OverrideDialog({
    open,
    onClose,
    proposal,
    onConfirm,
    applying,
    failure,
}: OverrideDialogProps) {
    const { t } = useTranslation();

    const suggestedEnergy =
        proposal.targets?.targetEnergy ?? (energyFromMacros(proposal.macros) || MIN_ENERGY);

    const [reason, setReason] = useState('');
    const [energy, setEnergy] = useState(String(suggestedEnergy));
    const [touched, setTouched] = useState(false);

    const parsedEnergy = Number.parseInt(energy, 10);
    const energyValid =
        Number.isFinite(parsedEnergy) && parsedEnergy >= MIN_ENERGY && parsedEnergy <= MAX_ENERGY;
    const reasonValid = reason.trim() !== '';

    return (
        <Dialog
            open={open}
            onClose={onClose}
            testID={VD_OVERRIDE_DIALOG_TEST_ID}
            title={t('virtualDietitian:override.dialogTitle')}
            description={t('virtualDietitian:override.dialogDescription')}
            actions={
                <>
                    <Button
                        testID={`${VD_OVERRIDE_DIALOG_TEST_ID}-cancel`}
                        variant="quiet"
                        label={t('virtualDietitian:override.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID={`${VD_OVERRIDE_DIALOG_TEST_ID}-confirm`}
                        variant="primary"
                        loading={applying}
                        label={
                            applying
                                ? t('virtualDietitian:override.applying')
                                : t('virtualDietitian:override.confirm')
                        }
                        onPress={() => {
                            setTouched(true);
                            if (!reasonValid || !energyValid) return;
                            onConfirm({
                                reason: reason.trim(),
                                targetEnergy: parsedEnergy,
                                macros: rescaleMacros(proposal.macros, parsedEnergy),
                            });
                        }}
                    />
                </>
            }
        >
            <Stack space="md">
                <Callout
                    testID={`${VD_OVERRIDE_DIALOG_TEST_ID}-consequences`}
                    role="note"
                    tone="warning"
                    title={t('virtualDietitian:override.consequencesTitle')}
                    body={t('virtualDietitian:override.consequencesBody')}
                />

                <TextInputField
                    testID={`${VD_OVERRIDE_DIALOG_TEST_ID}-reason`}
                    label={t('virtualDietitian:override.reasonLabel')}
                    hint={t('virtualDietitian:override.reasonHint')}
                    required
                    value={reason}
                    onChangeText={setReason}
                    {...(touched && !reasonValid
                        ? { error: t('virtualDietitian:override.reasonRequired') }
                        : {})}
                />

                <TextInputField
                    testID={`${VD_OVERRIDE_DIALOG_TEST_ID}-energy`}
                    label={t('virtualDietitian:override.energyLabel')}
                    hint={t('virtualDietitian:override.energyHint')}
                    inputMode="numeric"
                    keyboardType="number-pad"
                    value={energy}
                    onChangeText={setEnergy}
                    {...(touched && !energyValid
                        ? { error: t('virtualDietitian:override.energyInvalid') }
                        : {})}
                />

                {failure === null ? null : (
                    <Text
                        testID={`${VD_OVERRIDE_DIALOG_TEST_ID}-error`}
                        tone="danger"
                        role="alert"
                        aria-live="assertive"
                    >
                        {failure}
                    </Text>
                )}
            </Stack>
        </Dialog>
    );
}
