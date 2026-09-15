import { z } from "zod";

export const accountFormSchema = z.object({
	name: z.string().min(1, "Name is required"),
	language: z.string().min(2),
});

export const profileFormSchema = z.object({
	username: z.string().optional(),
	email: z.string().email(),
	bio: z.string().optional(),
});
