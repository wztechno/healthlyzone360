import type { VdProposal } from '@healthy360/api-client/contracts';
import {
    Accordion,
    Badge,
    Button,
    Callout,
    Card,
    Checkbox,
    Heading,
    Inline,
    ProgressRing,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { OriginBadge, OriginValue } from './origin-badge.tsx';
import { energyFromMacros } from './override-dialog.tsx';

/**
 * The suggested calorie and macronutrient targets.
 *
 * ## Every proposed figure carries its origin, and an override does not overwrite the suggestion
 *
 * When a person has replaced the figures, both readings stay on screen: the machine's, labelled
 * "AI-generated suggestion", and theirs, labelled "Set by you". Replacing the first with the second
 * would destroy the only record of what was suggested, and it is precisely that record which lets a
 * dietitian later ask "why did you change this?".
 *
 * ## The acknowledgement is a real gate, not a formality
 *
 * `acceptProposal` refuses a request whose `acknowledgedDisclaimer` is false, and the contract says
 * why: the acceptance is recorded so the UI can prove the person saw the disclaimer before
 * accepting. So the checkbox blocks the control rather than being sent as `true` regardless, and the
 * disabled button carries a visible reason — a disabled control with no explanation is the other way
 * to build a dead button.
 *
 * ## "Decline" hands over rather than pretending to negotiate
 *
 * There is no state in the contract for "the person did not like the numbers". The honest outcome is
 * the one the product already has: send the session to a qualified dietitian. So the third action is
 * `requestReview`, worded as what it does.
 */
export interface TargetsPanelProps {
    readonly proposal: VdProposal;
    readonly onAccept: (acknowledged: boolean) => void;
    readonly accepting: boolean;
    readonly acceptFailure: string | null;
    readonly onOverride: () => void;
    readonly onRequestReview: () => void;
    readonly requestingReview: boolean;
    readonly onContinue: () => void;
    readonly continuing: boolean;
    readonly testID?: string | undefined;
}

export function TargetsPanel({
    proposal,
    onAccept,
    accepting,
    acceptFailure,
    onOverride,
    onRequestReview,
    requestingReview,
    onContinue,
    continuing,
    testID = 'vd-targets',
}: TargetsPanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const [acknowledged, setAcknowledged] = useState(false);

    const targets = proposal.targets;
    const overridden = proposal.overriddenAt !== null;
    const humanEnergy = energyFromMacros(proposal.macros);

    const energyUnit = t('virtualDietitian:targets.energyUnit');
    const energyText = (value: number) => `${formatter.formatNumber(value)} ${energyUnit}`;

    const explanationItems = [
        {
            key: 'rationale',
            title: t('virtualDietitian:targets.rationaleTitle'),
            testID: `${testID}-rationale`,
            children: (
                <Stack space="xs">
                    {proposal.rationale.map((line) => (
                        <Text key={line} variant="caption">
                            {line}
                        </Text>
                    ))}
                </Stack>
            ),
        },
        {
            key: 'assumptions',
            title: t('virtualDietitian:targets.assumptionsTitle'),
            testID: `${testID}-assumptions`,
            children: (
                <Stack space="xs">
                    {proposal.assumptions.map((line) => (
                        <Text key={line} variant="caption">
                            {line}
                        </Text>
                    ))}
                </Stack>
            ),
        },
        ...(targets === null
            ? []
            : [
                  {
                      key: 'arithmetic',
                      title: t('virtualDietitian:targets.explanationTitle'),
                      testID: `${testID}-arithmetic`,
                      children: (
                          <Stack space="sm">
                              <Text variant="caption">{targets.explanation.summary}</Text>
                              {targets.explanation.steps.map((step) => (
                                  <Stack key={step.id} space="xs">
                                      <Text variant="label">{step.title}</Text>
                                      <Text variant="caption" tone="secondary">
                                          {step.detail}
                                      </Text>
                                      {step.formula === null ? null : (
                                          <Text variant="mono" tone="secondary">
                                              {t('virtualDietitian:targets.stepFormula', {
                                                  formula: step.formula,
                                              })}
                                          </Text>
                                      )}
                                      {step.output === null ? null : (
                                          <Text variant="caption" tone="secondary">
                                              {t('virtualDietitian:targets.stepOutput', {
                                                  output: formatter.formatNumber(step.output),
                                              })}
                                          </Text>
                                      )}
                                  </Stack>
                              ))}
                          </Stack>
                      ),
                  },
                  {
                      key: 'citations',
                      title: t('virtualDietitian:targets.citationsTitle'),
                      testID: `${testID}-citations`,
                      children: (
                          <Stack space="xs">
                              {targets.explanation.citations.map((citation) => (
                                  <Text key={citation} variant="caption" tone="secondary">
                                      {citation}
                                  </Text>
                              ))}
                          </Stack>
                      ),
                  },
              ]),
    ];

    return (
        <Stack space="md" testID={testID}>
            <Inline space="sm" align="center">
                <Heading level={2}>{t('virtualDietitian:targets.title')}</Heading>
                <OriginBadge kind="ai" testID={`${testID}-heading-origin`} />
            </Inline>

            <Card padding="md" tone="raised" testID={`${testID}-energy`}>
                <Inline space="lg" wrap align="start">
                    {targets === null ? null : (
                        <OriginValue
                            testID={`${testID}-maintenance`}
                            label={t('virtualDietitian:targets.maintenance')}
                            value={energyText(targets.maintenanceEnergy)}
                            origin="ai"
                        />
                    )}
                    {targets === null ? null : (
                        <OriginValue
                            testID={`${testID}-suggested-energy`}
                            label={t('virtualDietitian:targets.target')}
                            value={energyText(targets.targetEnergy)}
                            origin="ai"
                            caption={t('virtualDietitian:targets.prototypeNote')}
                        />
                    )}
                    {overridden ? (
                        <OriginValue
                            testID={`${testID}-human-energy`}
                            label={t('virtualDietitian:targets.yourTarget')}
                            value={energyText(humanEnergy)}
                            origin={proposal.overriddenBy === null ? 'human' : 'dietitian'}
                        />
                    ) : null}
                </Inline>
            </Card>

            {overridden ? (
                <Callout
                    testID={`${testID}-override-notice`}
                    role="note"
                    tone="success"
                    icon="user"
                    title={t('virtualDietitian:override.appliedTitle')}
                    body={t('virtualDietitian:override.appliedBody')}
                />
            ) : null}

            <Stack space="sm" testID={`${testID}-macros`}>
                <Heading level={3}>{t('virtualDietitian:targets.macrosTitle')}</Heading>
                <Inline space="lg" wrap align="start">
                    {proposal.macros.map((macro) => (
                        <Stack
                            key={macro.nutrientId}
                            space="xs"
                            align="center"
                            testID={`${testID}-macro-${macro.nutrientId}`}
                        >
                            <ProgressRing
                                testID={`${testID}-macro-${macro.nutrientId}-ring`}
                                label={t(`virtualDietitian:targets.macro.${macro.nutrientId}`)}
                                value={macro.percentageOfEnergy}
                                target={100}
                                caption={t('virtualDietitian:targets.macroShare')}
                                size="sm"
                            />
                            <Text variant="label">
                                {t(`virtualDietitian:targets.macro.${macro.nutrientId}`)}
                            </Text>
                            <Text variant="caption" tone="secondary">
                                {t('virtualDietitian:targets.macroFigures', {
                                    grams: formatter.formatNumber(macro.grams),
                                    kilocalories: formatter.formatNumber(macro.kilocalories),
                                })}
                            </Text>
                            <Text variant="caption" tone="secondary">
                                {t('virtualDietitian:targets.tolerance', {
                                    min: formatter.formatNumber(macro.tolerance.min),
                                    max: formatter.formatNumber(macro.tolerance.max),
                                })}
                            </Text>
                            <OriginBadge
                                kind={
                                    overridden
                                        ? proposal.overriddenBy === null
                                            ? 'human'
                                            : 'dietitian'
                                        : 'ai'
                                }
                                testID={`${testID}-macro-${macro.nutrientId}-origin`}
                            />
                        </Stack>
                    ))}
                </Inline>
            </Stack>

            {targets === null ? null : (
                <Inline space="xs" align="center" testID={`${testID}-method`}>
                    <Text variant="caption" tone="secondary">
                        {t('virtualDietitian:targets.methodTitle')}
                    </Text>
                    <Badge
                        testID={`${testID}-method-badge`}
                        tone="neutral"
                        icon="info"
                        label={t(`virtualDietitian:targets.methodName.${targets.method}`)}
                    />
                </Inline>
            )}

            <Accordion testID={`${testID}-explanation`} items={explanationItems} />

            {proposal.acceptedAt === null ? (
                <Stack space="sm" testID={`${testID}-accept-block`}>
                    <Checkbox
                        testID={`${testID}-acknowledge`}
                        checked={acknowledged}
                        onChange={setAcknowledged}
                        label={t('virtualDietitian:targets.acknowledge')}
                    />
                    {acknowledged ? null : (
                        <Text variant="caption" tone="secondary" testID={`${testID}-accept-hint`}>
                            {t('virtualDietitian:targets.acknowledgeRequired')}
                        </Text>
                    )}
                    <Inline space="sm" wrap>
                        <Button
                            testID={`${testID}-accept`}
                            variant="primary"
                            disabled={!acknowledged}
                            loading={accepting}
                            label={
                                accepting
                                    ? t('virtualDietitian:targets.accepting')
                                    : t('virtualDietitian:targets.accept')
                            }
                            onPress={() => {
                                onAccept(acknowledged);
                            }}
                        />
                        <Button
                            testID={`${testID}-adjust`}
                            variant="secondary"
                            label={t('virtualDietitian:targets.adjust')}
                            onPress={onOverride}
                        />
                        <Button
                            testID={`${testID}-decline`}
                            variant="ghost"
                            loading={requestingReview}
                            accessibilityHint={t('virtualDietitian:targets.declineHint')}
                            label={t('virtualDietitian:targets.decline')}
                            onPress={onRequestReview}
                        />
                    </Inline>
                </Stack>
            ) : (
                <Stack space="sm" testID={`${testID}-accepted`}>
                    <Callout
                        testID={`${testID}-accepted-notice`}
                        role="note"
                        tone="success"
                        title={t('virtualDietitian:timeline.accepted')}
                        body={t('virtualDietitian:targets.accepted', {
                            date: formatter.formatDate(proposal.acceptedAt, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                            }),
                        })}
                    />
                    <Inline space="sm" wrap>
                        <Button
                            testID={`${testID}-continue`}
                            variant="primary"
                            loading={continuing}
                            label={t('virtualDietitian:targets.continue')}
                            onPress={onContinue}
                        />
                        <Button
                            testID={`${testID}-adjust-after`}
                            variant="secondary"
                            label={t('virtualDietitian:targets.adjust')}
                            onPress={onOverride}
                        />
                    </Inline>
                </Stack>
            )}

            {acceptFailure === null ? null : (
                <Text
                    testID={`${testID}-accept-error`}
                    tone="danger"
                    role="alert"
                    aria-live="assertive"
                >
                    {acceptFailure}
                </Text>
            )}
        </Stack>
    );
}
