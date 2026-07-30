import type { SendVdMessageRequest } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Chip,
    Heading,
    Inline,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { VdSessionState } from '@healthy360/domain-types';
import { useTranslation } from 'react-i18next';

import { acceptsReply, quickReplyKey, quickRepliesFor } from './state-presentation.ts';

/**
 * The reply box, and the suggested answers above it.
 *
 * ## Quick replies are the person's words, not a menu of commands
 *
 * Each chip sends a full sentence together with the structured answers it stands for
 * (`SendVdMessageRequest.answers`). That is why the collected panel fills in as the interview
 * proceeds without the composer holding any state of its own: the answers go to the repository, the
 * repository puts them on the message, and the panel reads them back off the session.
 *
 * A chip is not a shortcut past the free-text box either. Both paths call the same mutation with the
 * same request shape, so anything a chip can reach, typing can reach too.
 *
 * ## A state with no reply box says so
 *
 * `acceptsReply` is data, not a condition written here (`state-presentation.ts`). Where a reply
 * would be meaningless — an approved plan, an escalated conversation — the composer renders a short
 * explanation instead of a control that would quietly do something unexpected. The prompt forbids
 * dead controls; a control that works but does the wrong thing is worse than a dead one.
 */
export interface ComposerProps {
    readonly state: VdSessionState;
    readonly onSend: (request: SendVdMessageRequest) => void;
    readonly sending: boolean;
    readonly error: string | null;
    /** Pre-fills the box — used by the missing-information panel's "answer this" controls. */
    readonly draft: string;
    readonly onDraftChange: (value: string) => void;
    readonly testID?: string | undefined;
}

export const VD_COMPOSER_TEST_ID = 'vd-composer';

export function Composer({
    state,
    onSend,
    sending,
    error,
    draft,
    onDraftChange,
    testID = VD_COMPOSER_TEST_ID,
}: ComposerProps) {
    const { t } = useTranslation();

    if (!acceptsReply(state)) {
        return (
            <Callout
                testID={`${testID}-closed`}
                role="note"
                tone="info"
                title={t('virtualDietitian:chat.closedTitle')}
                body={t('virtualDietitian:chat.closedBody')}
            />
        );
    }

    const replies = quickRepliesFor(state);
    const trimmed = draft.trim();

    return (
        <Stack space="sm" testID={testID}>
            {replies.length === 0 ? null : (
                <Stack space="xs" testID={`${testID}-quick-replies`}>
                    <Heading level={3}>{t('virtualDietitian:chat.quickRepliesTitle')}</Heading>
                    <Inline space="xs" wrap>
                        {replies.map((reply) => {
                            const body = t(quickReplyKey(state, reply.key));
                            return (
                                <Chip
                                    key={reply.key}
                                    testID={`${testID}-quick-${reply.key}`}
                                    label={body}
                                    tone="brand"
                                    disabled={sending}
                                    onPress={() => {
                                        onSend({
                                            body,
                                            ...(reply.answers === undefined
                                                ? {}
                                                : { answers: reply.answers }),
                                        });
                                    }}
                                />
                            );
                        })}
                    </Inline>
                </Stack>
            )}

            <TextInputField
                testID={`${testID}-reply`}
                label={t('virtualDietitian:chat.inputLabel')}
                placeholder={t('virtualDietitian:chat.inputPlaceholder')}
                value={draft}
                onChangeText={onDraftChange}
                multiline
                disabled={sending}
                {...(error === null ? {} : { error })}
            />

            <Inline space="sm" align="center">
                <Button
                    testID={`${testID}-send`}
                    label={
                        sending
                            ? t('virtualDietitian:chat.sending')
                            : t('virtualDietitian:chat.send')
                    }
                    loading={sending}
                    disabled={trimmed === ''}
                    onPress={() => {
                        onSend({ body: trimmed });
                        onDraftChange('');
                    }}
                />
                <Text variant="caption" tone="secondary" className="flex-1">
                    {t('virtualDietitian:interview.body')}
                </Text>
            </Inline>
        </Stack>
    );
}
