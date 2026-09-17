import { Controller, Get, Post, Patch, Put, Param, Body, ParseIntPipe, Query, Req, BadRequestException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { TasksService } from './tasks.service';
import { AiService } from '../../core/ai/ai.service';
import { StorageService } from '../../core/storage/storage.service';

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly aiService: AiService,
    private readonly storageService: StorageService,
  ) {}

  @Post('upload')
  async uploadTaskFile(@Req() req: any, @Query('folder') folder?: string) {
    const fastifyReq = req as any;
    if (typeof fastifyReq.isMultipart === 'function' && !fastifyReq.isMultipart()) {
      throw new BadRequestException('Request is not multipart');
    }

    const parts = fastifyReq.parts();
    let fileBuffer: Buffer | null = null;
    let filename = '';

    for await (const part of parts) {
      if (part.file) {
        fileBuffer = await part.toBuffer();
        filename = part.filename;
        break;
      }
    }

    if (!fileBuffer || !filename) {
      throw new BadRequestException('No file uploaded');
    }

    let fileUrl: string;
    if (folder === 'compliance_documents' || folder === 'documents') {
      fileUrl = await this.storageService.uploadDocumentFile(fileBuffer, filename);
    } else {
      fileUrl = await this.storageService.uploadTaskFile(fileBuffer, filename, folder || 'tasks-upload');
    }
    return { file_url: fileUrl, filename };
  }

  @Get('stats')
  async getStats(@Query('circular_id') circularId?: string) {
    return this.tasksService.getStats(circularId ? parseInt(circularId, 10) : undefined);
  }

  @Get()
  async getTasks(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('status') status?: string,
    @Query('circular_id') circularId?: string,
    @Query('search') search?: string,
  ) {
    return this.tasksService.findAllPaginated({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      status,
      circularId: circularId ? parseInt(circularId, 10) : undefined,
      search,
    });
  }

  @Patch('approve-all')
  approveAllTasks(@Query('circularId') circularId?: string) {
    const parsedId = circularId ? parseInt(circularId, 10) : undefined;
    return this.tasksService.approveAll(parsedId);
  }

  @Patch(':id/approve')
  approveTask(@Param('id', ParseIntPipe) id: number) {
    return this.tasksService.approve(id);
  }

  @Post('manual')
  createManualTask(
    @Body('description') description: string,
    @Body('circular_id') circularId?: number,
    @Body('header_id') headerId?: number,
    @Body('priority') priority?: string,
    @Body('risk_category') riskCategory?: string,
    @Body('business_risk') businessRisk?: string,
    @Body('control_risk') controlRisk?: string,
    @Body('audit_area_id') auditAreaId?: number,
    @Body('file_url') fileUrl?: string,
    @Body('authority_id') authorityId?: number,
  ) {
    return this.tasksService.createManual(description, circularId, headerId, priority, riskCategory, businessRisk, controlRisk, auditAreaId, fileUrl, authorityId);
  }

  @Put(':id')
  updateTask(
    @Param('id', ParseIntPipe) id: number, 
    @Body('description') description: string,
    @Body('header_id') headerId?: number,
    @Body('priority') priority?: string,
    @Body('risk_category') riskCategory?: string,
    @Body('business_risk') businessRisk?: string,
    @Body('control_risk') controlRisk?: string,
    @Body('audit_area_id') auditAreaId?: number,
    @Body('file_url') fileUrl?: string,
  ) {
    return this.tasksService.update(id, description, headerId, priority, riskCategory, businessRisk, controlRisk, auditAreaId, fileUrl);
  }

  @Post('extract-from-text')
  async extractFromText(@Body('text') text: string) {
    const tasks = await this.aiService.extractTasksFromChatText(text);
    return { tasks };
  }

  @Post('bulk')
  async createBulk(
    @Body('circular_id', ParseIntPipe) circularId: number,
    @Body('tasks') tasks: { description: string }[],
  ) {
    return this.tasksService.createBulk(circularId, tasks);
  }
}
