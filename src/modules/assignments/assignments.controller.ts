// AssignmentsController — handles all /assignments/* routes
import { Controller, Get, Post, Put, Patch, Param, Body, Req, Query, BadRequestException, Header } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';
import { AssignmentsSchedulerService } from './assignments-scheduler.service';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../core/auth/public.decorator';

@Controller('assignments')
export class AssignmentsController {
  constructor(
    private readonly assignmentsService: AssignmentsService,
    private readonly assignmentsSchedulerService: AssignmentsSchedulerService
  ) {}

  @Public()
  @Post('generate-assignments')
  async triggerAutoGeneration(@Body('task_set_id') taskSetId?: number) {
    return this.assignmentsSchedulerService.generateAssignmentsForActiveTaskSets(taskSetId);
  }

  @Public()
  @Post('reset-and-regenerate')
  async resetAndRegenerate() {
    return this.assignmentsSchedulerService.resetAndRegenerateAssignments();
  }

  @Post()
  async create(
    @Body('task_set_id') taskSetId: number,
    @Body('branch_ids') branchIds: number[],
    @Body('proposed_timeline') proposedTimeline: string
  ) {
    return this.assignmentsService.create(taskSetId, branchIds, proposedTimeline);
  }


  @Get()
  async getAssignments(
    @Query('branch_id') branchId: string, 
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Req() req: FastifyRequest,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('only_expired') onlyExpired?: string,
    @Query('task_set_type') taskSetType?: string,
    @Query('frequency') frequency?: string,
    @Query('task_set_id') taskSetId?: string
  ) {
    const user = (req as any).user;
    let finalBranchId = branchId ? parseInt(branchId, 10) : undefined;
    
    if (user?.role === 'BRANCH' || user?.role === 'BRANCH_USER' || user?.role === 'DEPARTMENT') {
      const bId = user.branchId || user.branch_id;
      if (bId && !finalBranchId) {
        finalBranchId = parseInt(bId, 10);
      }
    }

    return this.assignmentsService.findAllPaginated({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      branchId: finalBranchId,
      search,
      status,
      onlyExpired: onlyExpired === 'true',
      taskSetType,
      frequency,
      taskSetId: taskSetId ? parseInt(taskSetId, 10) : undefined
    });
  }

  @Put(':id/extend-timeline')
  async extendTimeline(
    @Param('id') id: string,
    @Body('date') date: string
  ) {
    if (!date) {
      throw new BadRequestException('Extension date is required');
    }
    return this.assignmentsService.extendTimeline(parseInt(id, 10), date);
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.assignmentsService.updateStatus(parseInt(id, 10), status);
  }

  @Get(':id/tasks')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  async getAssignmentTasks(@Param('id') id: string) {
    return this.assignmentsService.getAssignmentTasks(parseInt(id, 10));
  }

  @Patch(':id/propose-timeline')
  async proposeTimeline(@Param('id') id: string, @Body('date') date: string) {
    return this.assignmentsService.proposeTimeline(parseInt(id, 10), date);
  }

  @Patch(':id/propose-custom-timeline')
  async proposeCustomTimeline(
    @Param('id') id: string,
    @Body('date') date: string,
    @Body('task_timelines') taskTimelines: { assignment_task_id: number; proposed_due_date: string }[]
  ) {
    return this.assignmentsService.proposeCustomTimeline(parseInt(id, 10), date, taskTimelines);
  }

  @Patch(':id/tasks/:taskId/propose-timeline')
  async proposeTaskTimeline(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body('proposed_due_date') proposedDueDate: string,
    @Body('proposed_remark') proposedRemark?: string
  ) {
    return this.assignmentsService.proposeTaskTimeline(parseInt(id, 10), parseInt(taskId, 10), proposedDueDate, proposedRemark);
  }

  @Patch(':id/tasks/:taskId/review-timeline')
  async reviewTaskTimeline(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body('status') status: 'APPROVED' | 'REJECTED',
    @Body('remark') remark?: string
  ) {
    return this.assignmentsService.reviewTaskTimeline(parseInt(id, 10), parseInt(taskId, 10), status, remark);
  }

  @Patch(':id/accept-timeline')
  async acceptTimeline(@Param('id') id: string) {
    return this.assignmentsService.acceptTimeline(parseInt(id, 10));
  }

  @Patch(':id/accept-timeline-with-changes')
  async acceptTimelineWithChanges(
    @Param('id') id: string,
    @Body('date') date?: string,
    @Body('task_timelines') taskTimelines?: { assignment_task_id: number; proposed_due_date: string }[]
  ) {
    return this.assignmentsService.acceptTimelineWithChanges(parseInt(id, 10), date, taskTimelines);
  }

  @Get(':id/evidence')
  async getEvidence(@Param('id') id: string) {
    return this.assignmentsService.getAssignmentEvidence(parseInt(id, 10));
  }

  @Post(':id/notify')
  async sendNotification(@Param('id') id: string, @Body('message') message: string) {
    return this.assignmentsService.sendNotification(parseInt(id, 10), message);
  }

  @Post(':id/tasks/:taskId/evidence')
  async uploadTaskEvidence(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Req() req: FastifyRequest
  ) {
    const fastifyReq = req as any;
    if (!fastifyReq.isMultipart()) {
      throw new BadRequestException('Request is not multipart');
    }

    const parts = fastifyReq.parts();
    const filesData: { buffer: Buffer; filename: string }[] = [];
    let remark = 'Evidence Document';
    let complianceStatus: 'COMPLIED' | 'NOT_COMPLIED' = 'COMPLIED';

    for await (const part of parts) {
      if (part.file) {
        const buffer = await part.toBuffer();
        filesData.push({ buffer, filename: part.filename });
      } else if (part.fieldname === 'remark') {
        remark = part.value as string;
      } else if (part.fieldname === 'compliance_status') {
        complianceStatus = part.value as 'COMPLIED' | 'NOT_COMPLIED';
      }
    }

    if (filesData.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const user = (req as any).user;
    const username = user?.username || 'Branch User';
    const role = user?.role || 'DEPARTMENT';

    return this.assignmentsService.addTaskEvidences(
      parseInt(taskId, 10),
      parseInt(id, 10),
      filesData,
      remark,
      username,
      complianceStatus,
      role
    );
  }

  
  @Patch(':id/tasks/:taskId/delegate')
  async delegateTask(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body('sub_dept_id') subDeptId: number | null
  ) {
    return this.assignmentsService.delegateTaskToSubDept(parseInt(taskId, 10), subDeptId);
  }

  @Patch(':id/tasks/:taskId/complete')
  async completeTaskDirectly(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body('compliance_status') complianceStatus: 'COMPLIED' | 'NOT_COMPLIED',
    @Body('remarks') remarks: string,
    @Req() req: FastifyRequest
  ) {
    const user = (req as any).user;
    const username = user?.username || 'Branch User';
    const role = user?.role || 'DEPARTMENT';

    return this.assignmentsService.completeTaskDirectly(
      parseInt(taskId, 10),
      parseInt(id, 10),
      complianceStatus,
      remarks,
      username,
      role
    );
  }

  @Put(':id/review')
  async reviewAssignment(
    @Param('id') id: string,
    @Body('action') action: 'ACCEPT' | 'REJECT' | 'ESCALATE',
    @Body('remark') remark: string,
    @Req() req: FastifyRequest
  ) {
    const user = (req as any).user;
    const username = user?.username || 'Reviewer';
    const role = user?.role || 'CO';
    return this.assignmentsService.reviewAssignment(parseInt(id, 10), action, remark, username, role);
  }

  @Patch(':id/tasks/:taskId/review-status')
  async reviewTaskStatus(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body('review_status') reviewStatus: 'APPROVED' | 'NEEDS_REDO' | 'ESCALATED',
    @Body('review_remark') reviewRemark: string | undefined,
    @Req() req: FastifyRequest
  ) {
    const user = (req as any).user;
    const username = user?.username || 'Reviewer';
    const role = user?.role || 'CO';

    return this.assignmentsService.reviewTaskStatus(parseInt(taskId, 10), reviewStatus, reviewRemark, username, role);
  }

  @Get(':id/tasks/:taskId/remarks-history')
  async getTaskRemarksHistory(
    @Param('id') id: string,
    @Param('taskId') taskId: string
  ) {
    return this.assignmentsService.getTaskRemarksHistory(parseInt(taskId, 10));
  }
}
