import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import { EmailService } from '../../core/email/email.service';
import { OnEvent } from '@nestjs/event-emitter';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly emailService: EmailService
  ) {}

  /**
   * Fetch notifications for a given authenticated user.
   * - ADMIN / CO / CCO  → role-level notifications (branch_id IS NULL)
   * - Branch users      → notifications scoped to their branch_id
   */
  async getNotificationsForUser(userId: string, role: string, branchId: number | null) {
    let query: string;
    let args: any[];

    if (role === 'ADMIN') {
      query = `
        SELECT * FROM notification
        ORDER BY created_at DESC
        LIMIT 50
      `;
      args = [];
    } else if (['CO', 'CCO'].includes(role)) {
      query = `
        SELECT * FROM notification
        WHERE branch_id IS NULL OR user_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `;
      args = [userId];
    } else {
      query = `
        SELECT * FROM notification
        WHERE branch_id = $1
        ORDER BY created_at DESC
        LIMIT 50
      `;
      args = [branchId];
    }

    const result = await this.db.query(query, args);
    return result.rows;
  }

  async markAsRead(id: number) {
    const query = `UPDATE notification SET is_read = true WHERE id = $1 RETURNING *`;
    const result = await this.db.query(query, [id]);
    return result.rows[0];
  }

  async markAllAsReadForUser(userId: string, role: string, branchId: number | null) {
    let query: string;
    let args: any[];

    if (role === 'ADMIN') {
      query = `
        UPDATE notification 
        SET is_read = true 
        WHERE is_read = false
      `;
      args = [];
    } else if (['CO', 'CCO'].includes(role)) {
      query = `
        UPDATE notification 
        SET is_read = true 
        WHERE (branch_id IS NULL OR user_id = $1) AND is_read = false
      `;
      args = [userId];
    } else {
      query = `
        UPDATE notification 
        SET is_read = true 
        WHERE branch_id = $1 AND is_read = false
      `;
      args = [branchId];
    }

    await this.db.query(query, args);
    return { success: true };
  }

  private buildEmailHtml(title: string, message: string, details?: { label: string; value: string }[]): string {
    const rowsHtml = (details || []).map(d => `
      <tr>
        <td width="35%" style="font-weight: 600; color: #4a5568; padding: 8px 10px; border-bottom: 1px solid #edf2f7;">${d.label}:</td>
        <td style="color: #2d3748; padding: 8px 10px; border-bottom: 1px solid #edf2f7;">${d.value}</td>
      </tr>
    `).join('');

    const tableHtml = details && details.length > 0 ? `
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; margin: 20px 0; background-color: #f8fafc; border-left: 4px solid #0e52a4; border-radius: 4px;">
        ${rowsHtml}
      </table>
    ` : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${title}</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f6f9; padding: 30px 10px;">
          <tr>
            <td align="center">
              <table border="0" cellpadding="0" cellspacing="0" width="580" style="max-width: 580px; width: 100%; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
                
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #0e52a4 0%, #1e3a8a 100%); padding: 28px 30px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">Compliance Pro</h1>
                    <p style="margin: 4px 0 0 0; color: #93c5fd; font-size: 12px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase;">Compliance Management System</p>
                  </td>
                </tr>

                <!-- Content Area -->
                <tr>
                  <td style="padding: 32px 30px;">
                    <h2 style="margin: 0 0 14px 0; color: #0f172a; font-size: 19px; font-weight: 700;">${title}</h2>
                    <p style="margin: 0 0 16px 0; color: #475569; font-size: 15px; line-height: 1.6;">
                      ${message}
                    </p>

                    ${tableHtml}

                    <p style="margin: 24px 0 0 0; color: #475569; font-size: 14px;">
                      Please log in to the <strong>Compliance Pro</strong> portal to view details and complete the compliance tasks.
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center; border-top: 1px solid #e2e8f0;">
                    <p style="margin: 0; font-size: 13px; font-weight: 600; color: #475569;">Compliance Pro Notifications</p>
                    <p style="margin: 4px 0 0 0; font-size: 12px; color: #94a3b8; line-height: 1.4;">
                      This is an automated system notification. Please do not reply directly to this email.
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
  }

  @OnEvent('assignment.updated')
  async handleAssignmentUpdatedEvent(payload: {
    assignmentId: number;
    status: string;
    branchId: number;
    taskSetName: string;
    previousStatus?: string;
    dueDate?: string;
  }) {
    this.logger.log(`Assignment ${payload.assignmentId} updated to ${payload.status} (previous: ${payload.previousStatus})`);

    // 1. When Compliance Starts / New Assignment is created:
    // Send in-app notification & emails to CO, CCO, and Department/Branch Head (NOT to sub-departments)
    if (payload.status === 'NEW_ASSIGNMENT') {
      const title = 'Compliance Assignment Started';
      const message = `New compliance assignment for "${payload.taskSetName}" has been initiated.`;
      const emailSubject = `[Compliance Started] ${payload.taskSetName}`;

      try {
        // Fetch branch info & check if it has a parent department
        const branchRes = await this.db.query(
          `SELECT id, name, parent_id FROM branch_dept WHERE id = $1`,
          [payload.branchId]
        );
        const branchInfo = branchRes.rows[0];
        const branchName = branchInfo?.name || 'Department / Branch';
        
        // Target Head Branch/Department ID (if sub-department, use parent_id so only head receives it)
        const headBranchId = branchInfo?.parent_id ? branchInfo.parent_id : payload.branchId;

        // In-App Notifications:
        // A) For the Department/Branch Head
        await this.db.query(
          `INSERT INTO notification (branch_id, title, message) VALUES ($1, $2, $3)`,
          [headBranchId, title, message]
        );

        // B) Role-level for CO & CCO
        await this.db.query(
          `INSERT INTO notification (title, message) VALUES ($1, $2)`,
          [title, message]
        );

        // Emails to: CO, CCO, and Department/Branch Head (NOT sub-departments)
        const coCcoUsers = await this.db.query(
          `SELECT email FROM users WHERE role IN ('CO', 'CCO', 'ADMIN') AND email IS NOT NULL AND is_active = true`
        );

        const headUsers = await this.db.query(
          `SELECT email FROM users WHERE branch_id = $1 AND role = 'BRANCH_USER' AND email IS NOT NULL AND is_active = true`,
          [headBranchId]
        );

        const recipientEmails = Array.from(
          new Set([
            ...coCcoUsers.rows.map((r: any) => r.email),
            ...headUsers.rows.map((r: any) => r.email)
          ])
        ).filter(Boolean);

        const emailHtml = this.buildEmailHtml(title, message, [
          { label: 'Task Set', value: payload.taskSetName },
          { label: 'Department / Branch', value: branchName },
          { label: 'Status', value: 'Started / In Progress' }
        ]);

        for (const email of recipientEmails) {
          this.emailService.sendMail(
            email,
            emailSubject,
            message,
            emailHtml
          ).catch(err => this.logger.error(`Failed to send compliance start email to ${email}`, err));
        }
      } catch (error) {
        this.logger.error('Error handling NEW_ASSIGNMENT notification/email', error);
      }
      return;
    }

    let title = '';
    let message = '';
    let emailSubject = '';
    let targetRoles: string[] = [];

    if (payload.status === 'REVIEW_PENDING') {
      title = 'Assignment Submitted for Review';
      message = `Branch submitted assignment for "${payload.taskSetName}". Waiting for CO review.`;
      emailSubject = `[Action Required] Assignment submitted for ${payload.taskSetName}`;
      targetRoles = ['ADMIN', 'CO', 'CCO'];
    } else if (payload.status === 'ESCALATED_TO_CCO') {
      title = 'Assignment Escalated to CCO';
      message = `Assignment for "${payload.taskSetName}" has been escalated to CCO for final review.`;
      emailSubject = `[Escalation] Assignment escalated to CCO - ${payload.taskSetName}`;
      targetRoles = ['ADMIN', 'CCO'];
    } else if (payload.status === 'COMPLETED') {
      title = 'Assignment Approved & Completed';
      message = `Your assignment for "${payload.taskSetName}" was approved and marked as Completed.`;
      emailSubject = `[Approved] ${payload.taskSetName}`;
    } else if (payload.status === 'In_Progress') {
      title = 'Timeline Approved';
      message = `The proposed due dates/timeline for assignment "${payload.taskSetName}" has been approved. You can now start submitting compliance checklist items.`;
      emailSubject = `[Timeline Approved] ${payload.taskSetName}`;
    } else {
      return; // Not a status we notify for
    }

    try {
      if (payload.status === 'REVIEW_PENDING' || payload.status === 'ESCALATED_TO_CCO') {
        // Store as role-level notification (branch_id = NULL so CO/CCO/ADMIN bell picks it up)
        await this.db.query(
          `INSERT INTO notification (title, message) VALUES ($1, $2)`,
          [title, message],
        );

        // Email targeted active users based on the list
        const usersResult = await this.db.query(
          `SELECT email FROM users WHERE role = ANY($1) AND email IS NOT NULL AND is_active = true`,
          [targetRoles],
        );
        for (const row of usersResult.rows) {
          this.emailService.sendMail(
            row.email,
            emailSubject,
            message,
            this.buildEmailHtml(title, message, [{ label: 'Task Set', value: payload.taskSetName }])
          ).catch(err => this.logger.error(`Failed to send email to ${row.email}`, err));
        }
      } else {
        const branchId = payload.branchId || (payload as any).branch_id || null;
        // Resolve parent branch if sub-department
        const branchRes = await this.db.query(`SELECT parent_id FROM branch_dept WHERE id = $1`, [branchId]);
        const headBranchId = branchRes.rows[0]?.parent_id || branchId;

        // COMPLETED / In_Progress: notify the branch head
        await this.db.query(
          `INSERT INTO notification (branch_id, title, message) VALUES ($1, $2, $3)`,
          [headBranchId, title, message],
        );

        // Email active head users of that branch
        const usersResult = await this.db.query(
          `SELECT email FROM users WHERE branch_id = $1 AND role = 'BRANCH_USER' AND email IS NOT NULL AND is_active = true`,
          [headBranchId],
        );
        for (const row of usersResult.rows) {
          this.emailService.sendMail(
            row.email,
            emailSubject,
            message,
            this.buildEmailHtml(title, message, [{ label: 'Task Set', value: payload.taskSetName }])
          ).catch(err => this.logger.error(`Failed to send email to ${row.email}`, err));
        }
      }

      // If CCO approved/completed an escalated assignment, also notify CO and ADMIN
      if (payload.status === 'COMPLETED' && payload.previousStatus === 'ESCALATED_TO_CCO') {
        const coTitle = 'Assignment Approved by CCO';
        const coMessage = `Chief Compliance Officer has approved the escalated assignment "${payload.taskSetName}".`;
        const coEmailSubject = `[Approved] CCO approved escalated assignment: ${payload.taskSetName}`;

        await this.db.query(
          `INSERT INTO notification (title, message) VALUES ($1, $2)`,
          [coTitle, coMessage],
        );

        const coUsersResult = await this.db.query(
          `SELECT email FROM users WHERE role IN ('ADMIN', 'CO') AND email IS NOT NULL AND is_active = true`
        );
        for (const row of coUsersResult.rows) {
          this.emailService.sendMail(
            row.email,
            coEmailSubject,
            coMessage,
            this.buildEmailHtml(coTitle, coMessage, [{ label: 'Task Set', value: payload.taskSetName }])
          ).catch(err => this.logger.error(`Failed to send CCO approval email to CO ${row.email}`, err));
        }
      }
    } catch (error) {
      this.logger.error('Error handling assignment update notification', error);
    }
  }

  // Dedicated handler for task delegation to sub-department
  @OnEvent('task.delegated')
  async handleTaskDelegatedEvent(payload: {
    assignmentId: number;
    assignmentTaskId: number;
    branchId: number;
    subDeptId: number;
    subDeptName: string;
    taskSetName: string;
    taskDescription: string;
  }) {
    this.logger.log(`Task ${payload.assignmentTaskId} delegated to sub-department ${payload.subDeptName}`);

    const title = 'Compliance Task Delegated';
    const message = `Task "${payload.taskDescription}" under "${payload.taskSetName}" has been assigned to sub-department "${payload.subDeptName}".`;
    const emailSubject = `[Task Delegated] ${payload.taskSetName} - ${payload.subDeptName}`;

    try {
      // 1. Resolve main Head branch ID
      const branchRes = await this.db.query(`SELECT parent_id FROM branch_dept WHERE id = $1`, [payload.branchId]);
      const headBranchId = branchRes.rows[0]?.parent_id || payload.branchId;

      // 2. In-App Notifications:
      // Head Branch
      await this.db.query(
        `INSERT INTO notification (branch_id, title, message) VALUES ($1, $2, $3)`,
        [headBranchId, title, message]
      );
      // Role-level for CO & CCO
      await this.db.query(
        `INSERT INTO notification (title, message) VALUES ($1, $2)`,
        [title, message]
      );

      // 3. Emails: to CO, CCO, and Main Department/Branch Head (NOT sub department users)
      const coCcoUsers = await this.db.query(
        `SELECT email FROM users WHERE role IN ('CO', 'CCO', 'ADMIN') AND email IS NOT NULL AND is_active = true`
      );

      const headUsers = await this.db.query(
        `SELECT email FROM users WHERE branch_id = $1 AND role = 'BRANCH_USER' AND email IS NOT NULL AND is_active = true`,
        [headBranchId]
      );

      const recipientEmails = Array.from(
        new Set([
          ...coCcoUsers.rows.map((r: any) => r.email),
          ...headUsers.rows.map((r: any) => r.email)
        ])
      ).filter(Boolean);

      const emailHtml = this.buildEmailHtml(title, message, [
        { label: 'Task Set', value: payload.taskSetName },
        { label: 'Task', value: payload.taskDescription },
        { label: 'Assigned Sub-Department', value: payload.subDeptName }
      ]);

      for (const email of recipientEmails) {
        this.emailService.sendMail(
          email,
          emailSubject,
          message,
          emailHtml
        ).catch(err => this.logger.error(`Failed to send task delegation email to ${email}`, err));
      }
    } catch (error) {
      this.logger.error('Error handling task.delegated notification', error);
    }
  }

  // Dedicated handler for CO/CCO rejections with review remark included
  @OnEvent('assignment.rejected')
  async handleAssignmentRejectedEvent(payload: {
    assignmentId: number;
    branchId: number;
    taskSetName: string;
    reviewRemark: string;
    previousStatus?: string;
  }) {
    this.logger.log(`Assignment ${payload.assignmentId} REJECTED — notifying branch ${payload.branchId} (previous: ${payload.previousStatus})`);

    const remarkPart = payload.reviewRemark
      ? ` Reviewer feedback: "${payload.reviewRemark}"`
      : '';

    const title = '🔴 Re-compliance Required';
    const message = `Your submission for "${payload.taskSetName}" has been returned for re-compliance.${remarkPart} Please login and resubmit the flagged tasks.`;
    const emailSubject = `[Action Required] Re-compliance Needed — ${payload.taskSetName}`;

    try {
      const branchId = payload.branchId || (payload as any).branch_id || null;
      const branchRes = await this.db.query(`SELECT parent_id FROM branch_dept WHERE id = $1`, [branchId]);
      const headBranchId = branchRes.rows[0]?.parent_id || branchId;

      await this.db.query(
        `INSERT INTO notification (branch_id, title, message) VALUES ($1, $2, $3)`,
        [headBranchId, title, message]
      );

      const usersResult = await this.db.query(
        `SELECT email FROM users WHERE branch_id = $1 AND role = 'BRANCH_USER' AND email IS NOT NULL AND is_active = true`,
        [headBranchId]
      );
      for (const row of usersResult.rows) {
        this.emailService.sendMail(
          row.email,
          emailSubject,
          message,
          this.buildEmailHtml(title, message, [
            { label: 'Task Set', value: payload.taskSetName },
            { label: 'Reviewer Feedback', value: payload.reviewRemark || 'Re-compliance requested' }
          ])
        ).catch(err => this.logger.error(`Failed to send rejection email to ${row.email}`, err));
      }

      // If CCO returned an escalated assignment to branch, also notify CO and ADMIN
      if (payload.previousStatus === 'ESCALATED_TO_CCO') {
        const coTitle = 'Escalated Assignment Returned';
        const coMessage = `Chief Compliance Officer returned the escalated assignment "${payload.taskSetName}" to the branch for re-compliance. Remarks: "${payload.reviewRemark || ''}"`;
        const coEmailSubject = `[Returned] CCO returned escalated assignment: ${payload.taskSetName}`;

        await this.db.query(
          `INSERT INTO notification (title, message) VALUES ($1, $2)`,
          [coTitle, coMessage],
        );

        const coUsersResult = await this.db.query(
          `SELECT email FROM users WHERE role IN ('ADMIN', 'CO') AND email IS NOT NULL AND is_active = true`
        );
        for (const row of coUsersResult.rows) {
          this.emailService.sendMail(
            row.email,
            coEmailSubject,
            coMessage,
            this.buildEmailHtml(coTitle, coMessage, [{ label: 'Task Set', value: payload.taskSetName }])
          ).catch(err => this.logger.error(`Failed to send CCO return email to CO ${row.email}`, err));
        }
      }
    } catch (error) {
      this.logger.error('Error handling assignment rejected notification', error);
    }
  }

  @OnEvent('timeline.task_reviewed')
  async handleTimelineTaskReviewedEvent(payload: {
    assignmentId: number;
    assignmentTaskId: number;
    status: 'APPROVED' | 'REJECTED';
    remark: string;
    branchId: number;
    taskSetName: string;
    taskDescription: string;
  }) {
    this.logger.log(`Task timeline for task ${payload.assignmentTaskId} reviewed: ${payload.status}`);

    const statusText = payload.status === 'APPROVED' ? 'Accepted' : 'Rejected';
    const title = `Task Proposed Date ${statusText}`;
    const message = `The proposed due date for task "${payload.taskDescription}" in "${payload.taskSetName}" has been ${statusText.toLowerCase()}.${payload.remark ? ' Remarks: "' + payload.remark + '"' : ''}`;
    const emailSubject = `[Timeline ${statusText}] ${payload.taskSetName} - ${payload.taskDescription}`;
    
    try {
      const branchId = payload.branchId;
      const branchRes = await this.db.query(`SELECT parent_id FROM branch_dept WHERE id = $1`, [branchId]);
      const headBranchId = branchRes.rows[0]?.parent_id || branchId;

      await this.db.query(
        `INSERT INTO notification (branch_id, title, message) VALUES ($1, $2, $3)`,
        [headBranchId, title, message],
      );

      const usersResult = await this.db.query(
        `SELECT email FROM users WHERE branch_id = $1 AND role = 'BRANCH_USER' AND email IS NOT NULL AND is_active = true`,
        [headBranchId],
      );
      for (const row of usersResult.rows) {
        this.emailService.sendMail(
          row.email,
          emailSubject,
          message,
          this.buildEmailHtml(title, message, [
            { label: 'Task Set', value: payload.taskSetName },
            { label: 'Task', value: payload.taskDescription },
            { label: 'Status', value: statusText }
          ])
        ).catch(err => this.logger.error(`Failed to send email to ${row.email}`, err));
      }
    } catch (error) {
      this.logger.error('Failed to send task timeline review notification', error);
    }
  }

  @OnEvent('assignment.custom_notify')
  async handleCustomNotify(payload: { branchId: number; taskSetName: string; timelineDate: string; message: string; }) {
    this.logger.log(`Custom notify to branch ${payload.branchId} for ${payload.taskSetName} (Due: ${payload.timelineDate})`);
    const title = 'Message from Compliance Officer';
    const msg = `Regarding "${payload.taskSetName}" (Due: ${payload.timelineDate}): ${payload.message}`;
    const emailSubject = `[Notice] Message regarding ${payload.taskSetName}`;
    
    try {
      const branchRes = await this.db.query(`SELECT parent_id FROM branch_dept WHERE id = $1`, [payload.branchId]);
      const headBranchId = branchRes.rows[0]?.parent_id || payload.branchId;

      await this.db.query(
        `INSERT INTO notification (branch_id, title, message) VALUES ($1, $2, $3)`,
        [headBranchId, title, msg],
      );

      const usersResult = await this.db.query(
        `SELECT email FROM users WHERE branch_id = $1 AND role = 'BRANCH_USER' AND email IS NOT NULL AND is_active = true`,
        [headBranchId],
      );
      for (const row of usersResult.rows) {
        this.emailService.sendMail(
          row.email, 
          emailSubject, 
          msg, 
          this.buildEmailHtml(title, msg, [
            { label: 'Task Set', value: payload.taskSetName },
            { label: 'Due Date', value: payload.timelineDate }
          ])
        ).catch(err => this.logger.error(`Failed to send email to ${row.email}`, err));
      }
    } catch (error) {
      this.logger.error('Failed to send custom notification', error);
    }
  }
}
