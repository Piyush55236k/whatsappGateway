import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/auth.config";

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    // Override jwt: refresh role dari DB secara berkala (node runtime) supaya
    // perubahan role (mis. dijadikan SUPERADMIN) langsung berlaku tanpa harus
    // logout/login. auth.config.ts (edge/middleware) tetap pakai jwt default tanpa DB.
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.roleCheckedAt = Date.now();
        return token;
      }
      const last = token.roleCheckedAt || 0;
      if (token.id && Date.now() - last > 60_000) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { role: true },
          });
          if (dbUser) token.role = dbUser.role;
          token.roleCheckedAt = Date.now();
        } catch {
          // Pertahankan role lama kalau query gagal (jangan blokir auth).
        }
      }
      return token;
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(1) })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          
          try {
            const cleanEmail = email.trim().toLowerCase();
            const user = await prisma.user.findUnique({ where: { email: cleanEmail } });
            if (!user) {
              console.warn(`[Auth] User not found for email: ${cleanEmail}`);
              return null;
            }

            const passwordsMatch = await bcrypt.compare(password, user.password);

            if (passwordsMatch) {
               return user;
            } else {
               console.warn(`[Auth] Password mismatch for email: ${cleanEmail}`);
               return null;
            }
          } catch (dbErr) {
            console.error("[Auth] Database error in authorize:", dbErr);
            return null;
          }
        }
        return null;
      },
    }),
  ],
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "akg-default-production-auth-secret-key-928471",
  trustHost: true,
});
