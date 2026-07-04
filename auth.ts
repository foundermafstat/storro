import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { isProtectedPath } from "@/server/protected-routes";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/sign-in",
  },
  callbacks: {
    authorized({ auth: session, request }) {
      if (!isProtectedPath(request.nextUrl.pathname)) {
        return true;
      }

      return Boolean(session?.user);
    },
    jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email;
      }

      if (user?.name) {
        token.name = user.name;
      }

      if (user?.image) {
        token.picture = user.image;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? token.email ?? "";
      }

      return session;
    },
  },
});
