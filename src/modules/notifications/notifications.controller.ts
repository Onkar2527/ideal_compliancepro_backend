import { Controller, Get, Post, Put, Param, Req, Body } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getNotifications(@Req() req: any) {
    // req.user is set by JwtAuthGuard from the Bearer token
    const user = req.user;
    const userId: string = user?.sub || user?.id || '';
    const role: string = user?.role || '';
    
    // Support both camelCase branchId and snake_case branch_id from JWT payload
    const rawBranchId = user?.branchId ?? user?.branch_id;
    const branchId: number | null = rawBranchId ? Number(rawBranchId) : null;

    return this.notificationsService.getNotificationsForUser(userId, role, branchId);
  }

  @Post()
  async createNotification(@Body() body: any, @Req() req: any) {
    const user = req.user;
    const userId: string = user?.sub || user?.id || '';
    return this.notificationsService.createCustomNotification({
      branchId: body.branch_id !== undefined ? body.branch_id : (body.branchId !== undefined ? body.branchId : null),
      userId: body.user_id || body.userId || null,
      title: body.title || 'New Notification',
      message: body.message || '',
      createdBy: userId
    });
  }

  @Put(':id/read')
  async markAsRead(@Param('id') id: string) {
    return this.notificationsService.markAsRead(parseInt(id, 10));
  }

  @Put('read-all')
  async markAllAsRead(@Req() req: any) {
    const user = req.user;
    const userId: string = user?.sub || user?.id || '';
    const role: string = user?.role || '';
    const rawBranchId = user?.branchId ?? user?.branch_id;
    const branchId: number | null = rawBranchId ? Number(rawBranchId) : null;

    return this.notificationsService.markAllAsReadForUser(userId, role, branchId);
  }
}


