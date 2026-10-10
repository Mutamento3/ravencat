import { Redirect, useLocalSearchParams } from 'expo-router';
import { isUserProfileField } from '@features/profile';
import ProfileRouteContent from '@host/navigation/ProfileRouteContent';

export default function ProfileFieldRoute() {
  const { field } = useLocalSearchParams<{ field: string }>();
  if (!isUserProfileField(field)) return <Redirect href="/profile" />;
  return <ProfileRouteContent field={field} />;
}
