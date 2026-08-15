import type { StaffAuthService } from "./staff-auth";

export const createLazyStaffAuthService = (
  load: () => Promise<StaffAuthService>,
): StaffAuthService => {
  let service: Promise<StaffAuthService> | undefined;
  const resolve = () => (service ??= load());

  return {
    signIn: async (email, password) => (await resolve()).signIn(email, password),
    signOut: async () => {
      if (service) await (await service).signOut();
    },
  };
};
