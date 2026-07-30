import { Link, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

export default function NotFoundScreen() {
    const { t } = useTranslation();

    return (
        <>
            <Stack.Screen options={{ title: t('access:notFound.title') }} />
            <View className="flex-1 items-center justify-center gap-4 bg-surface-base p-6">
                <Text className="text-2xl font-semibold text-content-primary text-start">
                    {t('access:notFound.title')}
                </Text>
                <Text className="max-w-md text-base text-content-secondary text-start">
                    {t('access:notFound.body')}
                </Text>
                <Link href="/" className="text-base font-medium text-surface-brand underline">
                    {t('access:notFound.home')}
                </Link>
            </View>
        </>
    );
}
