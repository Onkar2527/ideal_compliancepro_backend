import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { EmailService } from '../../core/email/email.service';
import { DatabaseService } from '../../core/database/database.service';

@Injectable()
export class AuthService {
  private readonly otpStore = new Map<
    string,
    { code: string; expires: number }
  >();

  private readonly resetOtpStore = new Map<
    string,
    { code: string; expires: number }
  >();

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly db: DatabaseService,
  ) {}

  async validateUser(username: string, pass: string): Promise<any> {
    const user = await this.usersService.findByUsername(username);

    if (!user) {
      throw new UnauthorizedException(`User '${username}' not found or inactive`);
    }

    let isValid = false;

    if (
      user.password_hash &&
      (user.password_hash.startsWith('$2a$') ||
        user.password_hash.startsWith('$2b$') ||
        user.password_hash.startsWith('$2y$'))
    ) {
      isValid = await bcrypt.compare(pass, user.password_hash);
    } else {
      isValid = pass === user.password_hash;
    }

    if (!isValid) {
      throw new UnauthorizedException(`Incorrect password for user '${username}'`);
    }

    const { password_hash, ...result } = user;
    return result;
  }

  async login(
    username: string,
    pass: string,
    ipAddress?: string,
    enable2fa?: boolean,
  ) {
    console.log(
      `[AuthService] Login attempt for user: "${username}", enable2fa: ${enable2fa}`,
    );
    const user = await this.validateUser(username, pass);

    if (enable2fa) {
      const email = user.email;
      console.log(
        `[AuthService] User found. Email registered in DB: "${email}"`,
      );
      if (!email) {
        console.warn(
          `[AuthService] Login failed: No email set for user: "${username}"`,
        );
        throw new UnauthorizedException(
          'No email address registered for this account',
        );
      }

      // Generate 6-digit OTP
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = Date.now() + 5 * 60 * 1000; // 5 minutes expiration
      this.otpStore.set(username, { code, expires });
      console.log(
        `[AuthService] Generated 2FA verification code: "${code}" for user: "${username}". Expires at: ${new Date(expires).toLocaleTimeString()}`,
      );

      // Send the email
      console.log(`[AuthService] Dispatching 2FA email to: "${email}"`);
      const mailHtml = `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 5px;">
          <h2 style="color: #333;">Compliance Pro Security Verification</h2>
          <p>You are attempting to log in to Compliance Pro. Use the following verification code to complete your sign-in:</p>
          <div style="font-size: 24px; font-weight: bold; background-color: #f7f7f7; padding: 10px 20px; border-radius: 4px; display: inline-block; letter-spacing: 2px; color: #0e52a4;">
            ${code}
          </div>
          <p style="margin-top: 20px; color: #666; font-size: 12px;">This code will expire in 5 minutes. If you did not request this code, please secure your account immediately.</p>
        </div>
      `;
      await this.emailService.sendMail(
        email,
        'Your 2FA Verification Code',
        `Your verification code is: ${code}. It will expire in 5 minutes.`,
        mailHtml,
      );
      console.log(`[AuthService] 2FA email dispatched successfully.`);

      return {
        requires2fa: true,
        username,
        emailMasked: this.maskEmail(email),
      };
    }

    return this.generateLoginResponse(user, ipAddress);
  }

  async verify2fa(username: string, code: string, ipAddress?: string) {
    const entry = this.otpStore.get(username);
    if (!entry) {
      throw new UnauthorizedException('No active verification code found');
    }

    if (Date.now() > entry.expires) {
      this.otpStore.delete(username);
      throw new UnauthorizedException('Verification code has expired');
    }

    if (entry.code !== code) {
      throw new UnauthorizedException('Invalid verification code');
    }

    this.otpStore.delete(username);

    const user = await this.usersService.findByUsername(username);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.generateLoginResponse(user, ipAddress);
  }

  async sendResetPasswordOtp(username: string) {
    const user = await this.usersService.findByUsername(username);
    if (!user) {
      throw new NotFoundException(`Employee code "${username}" not found`);
    }

    const email = user.email;
    if (!email) {
      throw new BadRequestException('No email address registered for this account');
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = Date.now() + 5 * 60 * 1000; // 5 minutes expiration
    this.resetOtpStore.set(username, { code, expires });

    const mailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset Verification</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f6f9; padding: 30px 10px;">
          <tr>
            <td align="center">
              <table border="0" cellpadding="0" cellspacing="0" width="580" style="max-width: 580px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
                
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #0e52a4 0%, #1e3a8a 100%); padding: 32px 30px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">Compliance Pro</h1>
                    <p style="margin: 6px 0 0 0; color: #93c5fd; font-size: 13px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase;">AI Powered Compliance Management</p>
                  </td>
                </tr>

                <!-- Content Area -->
                <tr>
                  <td style="padding: 36px 32px;">
                    <h2 style="margin: 0 0 16px 0; color: #0f172a; font-size: 20px; font-weight: 700;">Password Reset Verification</h2>
                    <p style="margin: 0 0 20px 0; color: #475569; font-size: 15px; line-height: 1.6;">
                      Hello,<br>
                      We received a request to reset your password for your <strong>Compliance Pro</strong> account (Employee Code: <strong>${username}</strong>).
                    </p>
                    <p style="margin: 0 0 20px 0; color: #475569; font-size: 15px; line-height: 1.6;">
                      Please enter the verification code below on the password reset screen to set a new password:
                    </p>

                    <!-- OTP Box -->
                    <div style="background-color: #f8fafc; border: 2px dashed #0e52a4; border-radius: 10px; padding: 20px; text-align: center; margin: 26px 0;">
                      <span style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #0e52a4; display: inline-block;">${code}</span>
                    </div>

                    <!-- Expiration & Security Alert -->
                    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fffbeb; border-radius: 8px; padding: 14px 16px; margin-top: 20px; border-left: 4px solid #f59e0b;">
                      <tr>
                        <td style="font-size: 13.5px; color: #92400e; line-height: 1.5;">
                          <strong>⏱️ Note:</strong> This code will expire in <strong>5 minutes</strong>. If you did not request this password reset, please disregard this email. Your existing password will remain safe.
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #f8fafc; padding: 22px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                    <p style="margin: 0; font-size: 13px; font-weight: 600; color: #475569;">Compliance Pro Access Security</p>
                    <p style="margin: 6px 0 0 0; font-size: 12px; color: #94a3b8; line-height: 1.4;">
                      This is an automated system email. Please do not reply directly to this message.
                    </p>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
    await this.emailService.sendMail(
      email,
      'Your Password Reset Verification Code',
      `Your verification code is: ${code}. It will expire in 5 minutes.`,
      mailHtml,
    );

    return {
      success: true,
      emailMasked: this.maskEmail(email),
    };
  }

  async verifyResetPasswordOtpAndReset(username: string, code: string, newPassword: string) {
    const entry = this.resetOtpStore.get(username);
    if (!entry) {
      throw new BadRequestException('No active password reset verification code found');
    }

    if (Date.now() > entry.expires) {
      this.resetOtpStore.delete(username);
      throw new BadRequestException('Verification code has expired');
    }

    if (entry.code !== code) {
      throw new BadRequestException('Invalid verification code');
    }

    const user = await this.usersService.findByUsername(username);
    if (!user) {
      throw new NotFoundException(`Employee code "${username}" not found`);
    }

    this.resetOtpStore.delete(username);

    const hash = await bcrypt.hash(newPassword, 10);
    const query = `
      UPDATE users 
      SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `;
    await this.db.query(query, [hash, user.id]);

    return { success: true };
  }

  async resetPasswordByLastPassword(username: string, lastPassword: string, newPassword: string) {
    const user = await this.usersService.findByUsername(username);
    if (!user) {
      throw new NotFoundException(`Employee code "${username}" not found`);
    }

    let isValid = false;
    if (
      user.password_hash &&
      (user.password_hash.startsWith('$2a$') ||
        user.password_hash.startsWith('$2b$') ||
        user.password_hash.startsWith('$2y$'))
    ) {
      isValid = await bcrypt.compare(lastPassword, user.password_hash);
    } else {
      isValid = lastPassword === user.password_hash;
    }

    if (!isValid) {
      throw new BadRequestException('Invalid last password');
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const query = `
      UPDATE users 
      SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `;
    await this.db.query(query, [hash, user.id]);

    return { success: true };
  }

  async resetPassword(username: string, newPassword: string) {
    const user = await this.usersService.findByUsername(username);
    if (!user) {
      throw new NotFoundException(`User with employee code "${username}" not found`);
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const query = `
      UPDATE users 
      SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `;
    await this.db.query(query, [hash, user.id]);
    return { success: true };
  }

  private maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return email;
    const name = parts[0];
    const domain = parts[1];
    if (name.length <= 2) return `**@${domain}`;
    return `${name.substring(0, 2)}***${name.substring(name.length - 2)}@${domain}`;
  }

  private async generateLoginResponse(user: any, ipAddress?: string) {
    const payload = {
      username: user.username,
      sub: user.id,
      fullName: user.full_name,
      role: user.role,
      branchId: user.branch_id,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        fullName: user.full_name,
        name: user.full_name,
        role: user.role,
        designation: user.role,
        branch_id: user.branch_id,
        branchId: user.branch_id,
        branch_name: user.branch_name,
        branchName: user.branch_name,
      },
    };
  }

  async logout(employeeId: number, ipAddress?: string) {
    // Logout handling
  }
}
