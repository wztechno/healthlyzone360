import { Redirect } from 'expo-router';

/**
 * `/customer` — the area's root has no page of its own. The signed-in home is the marketplace home,
 * `/discover`, which shows the signed-in extras (resume prompt, subscription, account tiles) to a
 * signed-in person. Old links and the workspace tile still arrive here, so this forwards them.
 */
export default function CustomerIndex() {
    return <Redirect href="/discover" />;
}
