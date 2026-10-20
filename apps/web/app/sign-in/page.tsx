import type { ReactElement } from "react";
import { createApiConfiguration, readWebEnvironment } from "@/config";
import { SignIn } from "@/features/identity";

const SignInPage = (): ReactElement => {
  const api = createApiConfiguration(readWebEnvironment());
  return <SignIn apiBaseUrl={api.baseUrl} />;
};

export default SignInPage;
