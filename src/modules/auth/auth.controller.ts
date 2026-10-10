import { Controller, Post, Body, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from '../../core/auth/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Public()
  async login(@Body() body: any, @Req() req: any) {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    return this.authService.login(body.username, body.password, ipAddress, body.enable_2fa);
  }

  @Post('verify-2fa')
  @HttpCode(HttpStatus.OK)
  @Public()
  async verify2fa(@Body() body: any, @Req() req: any) {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    return this.authService.verify2fa(body.username, body.code, ipAddress);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @Public()
  async resetPassword(@Body() body: any) {
    return this.authService.resetPassword(body.username, body.newPassword);
  }

  @Post('forgot-password/send-otp')
  @HttpCode(HttpStatus.OK)
  @Public()
  async sendResetPasswordOtp(@Body() body: any) {
    return this.authService.sendResetPasswordOtp(body.username);
  }

  @Post('forgot-password/verify-otp-and-reset')
  @HttpCode(HttpStatus.OK)
  @Public()
  async verifyResetPasswordOtpAndReset(@Body() body: any) {
    return this.authService.verifyResetPasswordOtpAndReset(body.username, body.code, body.newPassword);
  }

  @Post('forgot-password/reset-by-last-password')
  @HttpCode(HttpStatus.OK)
  @Public()
  async resetPasswordByLastPassword(@Body() body: any) {
    return this.authService.resetPasswordByLastPassword(body.username, body.lastPassword, body.newPassword);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Body() body: any, @Req() req: any) {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    await this.authService.logout(Number(body?.employee_id || 0), ipAddress);
    return { success: true };
  }
}
