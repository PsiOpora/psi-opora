import GuideEmail from "./emails/guide";
import OtpSignInEmail from "./emails/otp-sign-in";
import ResetPasswordEmail from "./emails/reset-password";
import WelcomeEmail from "./emails/welcome";

export type { EmailAttachment, EmailHtml, Emails } from "./send";
export { sendEmail, sendEmailHtml } from "./send";
export { GuideEmail, OtpSignInEmail, ResetPasswordEmail, WelcomeEmail };
