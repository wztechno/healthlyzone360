import { PrototypeScreen } from '../../src/screens/prototype-screen.tsx';

/**
 * Not functional in Phase 1 (plan §16). One shared screen, one thin route file — no bespoke empty
 * page, and no buttons that cannot do anything.
 */
export default function KdsIndex() {
    return <PrototypeScreen area="kds" testID="prototype-kds" />;
}
