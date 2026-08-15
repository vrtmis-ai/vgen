import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAppServices } from "../../runtime/AppServices";
import type { LoginInput, RegisterInput, StartPhoneVerificationInput, VerifyPhoneInput } from "../../runtime/contracts/auth";
import { appQueryKeys } from "./useSession";

/**
 * The credential calls, with the cache invalidation they all need.
 *
 * A session lives in an HttpOnly cookie, so nothing here returns something to
 * store. What each call changes is who the server thinks you are, and the only
 * way the app finds out is by asking again — hence the invalidation. Wallet and
 * catalog go too: they are per-account, and a stale wallet from the previous
 * identity is worse than an empty one.
 *
 * Errors are left to the caller rather than swallowed. `error.code` is the
 * contract — `invite_required`, `invalid_credentials`, `otp_invalid`,
 * `otp_exhausted`, `account_taken`, `rate_limited` — and a sign-in screen needs
 * to tell those apart to say anything useful. Do not branch on the message.
 */
export function useAuth() {
  const services = useAppServices();
  const queryClient = useQueryClient();

  const refreshIdentity = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appQueryKeys.session }),
      queryClient.invalidateQueries({ queryKey: appQueryKeys.wallet }),
      queryClient.invalidateQueries({ queryKey: appQueryKeys.catalog }),
    ]);
  };

  const startPhoneVerification = useMutation({
    mutationFn: (input: StartPhoneVerificationInput) => services.auth.startPhoneVerification(input),
  });

  const verifyPhone = useMutation({
    mutationFn: (input: VerifyPhoneInput) => services.auth.verifyPhone(input),
    onSuccess: refreshIdentity,
  });

  const register = useMutation({
    mutationFn: (input: RegisterInput) => services.auth.register(input),
    onSuccess: refreshIdentity,
  });

  const login = useMutation({
    mutationFn: (input: LoginInput) => services.auth.login(input),
    onSuccess: refreshIdentity,
  });

  const logout = useMutation({
    mutationFn: () => services.auth.logout(),
    // Everything cached belonged to the account that just left. Clearing beats
    // invalidating here: a refetch of a signed-out wallet would 401, and the
    // gate would paint an error where it should paint the landing page.
    onSuccess: async () => {
      queryClient.clear();
      await queryClient.invalidateQueries({ queryKey: appQueryKeys.session });
    },
  });

  return { startPhoneVerification, verifyPhone, register, login, logout };
}
