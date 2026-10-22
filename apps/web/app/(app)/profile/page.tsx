import type { ReactElement } from "react";
import { createApiConfiguration, readWebEnvironment } from "@/config";
import { ProfilePage } from "@/features/identity";

const ProfileRoute = (): ReactElement => {
  const api = createApiConfiguration(readWebEnvironment());
  return <ProfilePage apiBaseUrl={api.baseUrl} />;
};

export default ProfileRoute;
