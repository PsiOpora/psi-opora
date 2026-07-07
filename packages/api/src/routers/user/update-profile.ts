import { eq, user } from "@psi-opora/db";
import { profileFormSchema } from "@psi-opora/validators";

import { protectedProcedure } from "../../orpc";

/**
 * Update profile fields: username, email, bio.
 */
export const updateProfile = protectedProcedure
  .input(profileFormSchema)
  .handler(async ({ context, input }) => {
    await context.db
      .update(user)
      .set({
        username: input.username,
        email: input.email,
        bio: input.bio,
        updatedAt: new Date(),
      })
      .where(eq(user.id, context.session.user.id));

    return { success: true };
  });
