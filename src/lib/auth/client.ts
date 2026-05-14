import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

// Note: no `baseURL` is set on purpose. Better Auth's React client falls back
// to `window.location.origin` in the browser, so requests go to whichever port
// the page is actually served on (3000, 3002, prod URL, etc.). Setting
// `baseURL` would hardcode an origin and break login on any other port.
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
