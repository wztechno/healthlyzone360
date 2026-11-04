import { useState } from 'react';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { ExtraNote } from '../features/account/account-extra.tsx';
import { OtpChallengePanel } from '../features/verification/otp-challenge-panel.tsx';
import type { OtpChallengeView } from '../features/verification/otp-challenge-panel.tsx';
import { CodeBoxes } from '../ui/code-boxes.tsx';
import { ShopSwitch } from '../ui/shop-switch.tsx';

/**
 * `/showcase-shop` — the web shop's own parts, on a page of their own: the code boxes every
 * one-time code is typed into, in each state, the code panel as the sign-in frame draws it, the
 * boards' notes, and the shop's switch. Development only.
 */

/** A challenge as the server would describe one — enough to draw the panel without a backend. */
const SAMPLE_CHALLENGE: OtpChallengeView = {
    id: 'showcase',
    channel: 'sms',
    maskedDestination: '+971 50 ••• 4567',
    codeLength: 6,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    resendCooldownSeconds: 42,
    attemptsRemaining: 3,
    availableChannels: ['sms', 'whatsapp', 'email'],
    simulatedChannels: ['email'],
};

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
    return (
        <View className="flex-col gap-4 rounded-3xl border border-stroke-subtle bg-surface-raised p-6">
            <RNText className="text-lg font-bold text-content-primary text-start">{title}</RNText>
            {children}
        </View>
    );
}

function Labelled({ label, children }: { readonly label: string; readonly children: ReactNode }) {
    return (
        <View className="flex-col gap-2">
            <RNText className="text-sm font-semibold text-content-secondary text-start">
                {label}
            </RNText>
            {children}
        </View>
    );
}

export function ShopPartsShowcaseScreen() {
    const [code, setCode] = useState('');
    const [on, setOn] = useState(true);
    const [off, setOff] = useState(false);

    return (
        <View
            testID="shop-parts-showcase"
            className="w-full max-w-[880px] flex-col gap-6 self-center py-8"
        >
            <Section title="Code boxes">
                <Labelled label="Type here — the focused box blinks, digits pop in">
                    <CodeBoxes label="Code" length={6} value={code} onChangeText={setCode} />
                </Labelled>
                <Labelled label="Part typed">
                    <CodeBoxes label="Code" length={6} value="528" onChangeText={() => undefined} />
                </Labelled>
                <Labelled label="Wrong code">
                    <CodeBoxes
                        label="Code"
                        length={6}
                        value="528061"
                        error="That code is not right. Check it and try again."
                        onChangeText={() => undefined}
                    />
                </Labelled>
                <Labelled label="Large, on an account card">
                    <CodeBoxes
                        label="Code"
                        length={6}
                        size="lg"
                        align="start"
                        value="5280"
                        onChangeText={() => undefined}
                    />
                </Labelled>
            </Section>
            <Section title="Code panel — sign-in frame look (/verify-phone)">
                <View className="w-full max-w-[420px] self-center">
                    <OtpChallengePanel
                        look="auth"
                        testID="showcase-otp"
                        challenge={SAMPLE_CHALLENGE}
                        onVerify={() => undefined}
                        onResend={() => undefined}
                    />
                </View>
            </Section>
            <Section title="Board notes">
                <ExtraNote icon="send" title="Check n••••@example.com" body="A neutral note." />
                <ExtraNote tone="ok" icon="check" title="Saved" body="News in the brand's green." />
                <ExtraNote tone="amber" icon="clock" title="Wait a moment" body="A caution." />
                <ExtraNote tone="bad" icon="warning" title="This cannot be undone" body="Danger." />
            </Section>
            <Section title="Switch">
                <View className="flex-row items-center gap-6">
                    <ShopSwitch label="On" checked={on} onChange={setOn} />
                    <ShopSwitch label="Off" checked={off} onChange={setOff} />
                    <ShopSwitch label="Disabled" checked disabled onChange={() => undefined} />
                </View>
            </Section>
        </View>
    );
}
