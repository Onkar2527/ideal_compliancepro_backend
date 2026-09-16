import { Injectable } from '@nestjs/common';
import * as xlsx from 'xlsx';
import { DatabaseService } from '../../core/database/database.service';
import { CreateTaskSetDto } from './dto/create-task-set.dto';
import { UpdateTaskSetDto } from './dto/update-task-set.dto';
import { AssignmentsSchedulerService } from '../assignments/assignments-scheduler.service';

@Injectable()
export class TaskSetsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly assignmentsScheduler: AssignmentsSchedulerService
  ) { }

  async create(createTaskSetDto: CreateTaskSetDto) {
    const createdByRaw = createTaskSetDto.created_by || (createTaskSetDto as any).created_by_id || (createTaskSetDto as any).user_id || null;
    const createdBy = createdByRaw !== null && createdByRaw !== undefined ? String(createdByRaw) : null;
    const createdById = createdByRaw && !isNaN(Number(createdByRaw)) ? Number(createdByRaw) : null;
    const createdByRole = createTaskSetDto.created_by_role || (createTaskSetDto as any).creator_role || null;
    const createdByName = createTaskSetDto.created_by_name || (createTaskSetDto as any).creator_name || (createTaskSetDto as any).created_by_username || null;

    const query = `
      INSERT INTO task_set (
        name, circular_id, default_due_date, start_date, end_date, frequency,
        reporting_date, type, authority_id,
        reference_no, assignment_time, reporting_time, due_time,
        assignment_day_of_week, reporting_day_of_week, due_day_of_week,
        assignment_days_of_month, reporting_days_of_month, due_days_of_month,
        assignment_schedule, reporting_schedule, due_schedule,
        created_by, created_by_role, created_by_name, created_by_id
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
      RETURNING *
    `;
    const result = await this.db.query(query, [
      createTaskSetDto.name,
      createTaskSetDto.circular_id || null,
      createTaskSetDto.default_due_date || null,
      createTaskSetDto.start_date || null,
      createTaskSetDto.end_date || null,
      createTaskSetDto.frequency || null,
      createTaskSetDto.reporting_date || null,
      createTaskSetDto.type || 'REGULAR',
      createTaskSetDto.authority_id || null,
      createTaskSetDto.reference_no || null,
      createTaskSetDto.assignment_time || null,
      createTaskSetDto.reporting_time || null,
      createTaskSetDto.due_time || null,
      createTaskSetDto.assignment_day_of_week || null,
      createTaskSetDto.reporting_day_of_week || null,
      createTaskSetDto.due_day_of_week || null,
      createTaskSetDto.assignment_days_of_month || null,
      createTaskSetDto.reporting_days_of_month || null,
      createTaskSetDto.due_days_of_month || null,
      createTaskSetDto.assignment_schedule || null,
      createTaskSetDto.reporting_schedule || null,
      createTaskSetDto.due_schedule || null,
      createdBy,
      createdByRole,
      createdByName,
      createdById,
    ]);

    const taskSet = result.rows[0];

    if (createTaskSetDto.taskIds && createTaskSetDto.taskIds.length > 0) {
      const mappingValues = createTaskSetDto.taskIds.map(id => `(${taskSet.id}, ${id})`).join(',');
      await this.db.query(`INSERT INTO task_set_mapping (task_set_id, task_id) VALUES ${mappingValues}`);
    }

    return taskSet;
  }

  async findAll() {
    const result = await this.db.query(`
      SELECT ts.*,
        c.title AS circular_title,
        c.reference_no AS circular_reference_no,
        a.name AS authority_name,
        COALESCE(ts.created_by_name, u.full_name, u.username) AS created_by_username,
        COALESCE(ts.created_by_role, u.role) AS created_by_role,
        COALESCE(
          (
            SELECT string_agg(b.name, ', ' ORDER BY b.name)
            FROM task_set_branch tsb
            JOIN branch_dept b ON b.id = tsb.branch_id
            WHERE tsb.task_set_id = ts.id
          ),
          '—'
        ) AS branch_names
      FROM task_set ts
      LEFT JOIN circular c ON c.id = ts.circular_id
      LEFT JOIN authority a ON a.id = ts.authority_id
      LEFT JOIN users u ON u.id::TEXT = ts.created_by::TEXT
      ORDER BY ts.id DESC
    `);
    return result.rows;
  }

  async findOne(id: number) {
    const result = await this.db.query(`
      SELECT ts.*, a.name AS authority_name,
        COALESCE(ts.created_by_name, u.full_name, u.username) AS created_by_username,
        COALESCE(ts.created_by_role, u.role) AS created_by_role
      FROM task_set ts
      LEFT JOIN authority a ON a.id = ts.authority_id
      LEFT JOIN users u ON u.id::TEXT = ts.created_by::TEXT
      WHERE ts.id = $1
    `, [id]);
    const taskSet = result.rows[0];
    if (taskSet) {
      const tasksResult = await this.db.query(`
        SELECT t.*, tsm.due_date::TEXT as due_date, a.name as authority_name FROM compliance_task t
        LEFT JOIN authority a ON a.id = t.authority_id
        JOIN task_set_mapping tsm ON t.id = tsm.task_id
        WHERE tsm.task_set_id = $1
      `, [id]);
      taskSet.tasks = tasksResult.rows;

      const branchesResult = await this.db.query(`
        SELECT b.* FROM branch_dept b
        JOIN task_set_branch tsb ON b.id = tsb.branch_id
        WHERE tsb.task_set_id = $1
      `, [id]);
      taskSet.branches = branchesResult.rows;
    }
    return taskSet;
  }

  async update(id: number, updateTaskSetDto: UpdateTaskSetDto) {
    const createdByRaw = (updateTaskSetDto as any).created_by || (updateTaskSetDto as any).created_by_id || null;
    const createdBy = createdByRaw && !isNaN(Number(createdByRaw)) ? Number(createdByRaw) : null;
    const createdByRole = (updateTaskSetDto as any).created_by_role || (updateTaskSetDto as any).creator_role || null;
    const createdByName = (updateTaskSetDto as any).created_by_name || (updateTaskSetDto as any).creator_name || (updateTaskSetDto as any).created_by_username || null;

    const query = `
      UPDATE task_set
      SET name                     = COALESCE($1, name),
          circular_id              = $2,
          default_due_date         = $3,
          start_date               = COALESCE($4, start_date),
          end_date                 = $5,
          frequency                = COALESCE($6, frequency),
          reporting_date           = $7,
          type                     = COALESCE($8, type),
          authority_id             = $9,
          reference_no             = $10,
          assignment_time          = $11,
          reporting_time           = $12,
          due_time                 = $13,
          assignment_day_of_week   = $14,
          reporting_day_of_week    = $15,
          due_day_of_week          = $16,
          assignment_days_of_month = $17,
          reporting_days_of_month  = $18,
          due_days_of_month        = $19,
          assignment_schedule      = $20,
          reporting_schedule       = $21,
          due_schedule             = $22,
          created_by               = COALESCE($23, created_by),
          created_by_role          = COALESCE($24, created_by_role),
          created_by_name          = COALESCE($25, created_by_name)
      WHERE id = $26
      RETURNING *
    `;
    const result = await this.db.query(query, [
      updateTaskSetDto.name || null,
      updateTaskSetDto.circular_id || null,
      updateTaskSetDto.default_due_date || null,
      updateTaskSetDto.start_date || null,
      updateTaskSetDto.end_date || null,
      updateTaskSetDto.frequency || null,
      updateTaskSetDto.reporting_date || null,
      updateTaskSetDto.type || null,
      updateTaskSetDto.authority_id || null,
      updateTaskSetDto.reference_no || null,
      updateTaskSetDto.assignment_time || null,
      updateTaskSetDto.reporting_time || null,
      updateTaskSetDto.due_time || null,
      updateTaskSetDto.assignment_day_of_week || null,
      updateTaskSetDto.reporting_day_of_week || null,
      updateTaskSetDto.due_day_of_week || null,
      updateTaskSetDto.assignment_days_of_month || null,
      updateTaskSetDto.reporting_days_of_month || null,
      updateTaskSetDto.due_days_of_month || null,
      updateTaskSetDto.assignment_schedule || null,
      updateTaskSetDto.reporting_schedule || null,
      updateTaskSetDto.due_schedule || null,
      createdBy,
      createdByRole,
      createdByName,
      id
    ]);
    return result.rows[0];
  }

  async remove(id: number) {
    await this.db.query(`DELETE FROM task_set WHERE id = $1`, [id]);
    return { deleted: true };
  }

  async mapTasks(id: number, taskIds: number[], taskTimelines?: { task_id: number; due_date: string | null }[]) {
    // First clear existing mappings
    await this.db.query(`DELETE FROM task_set_mapping WHERE task_set_id = $1`, [id]);

    // Add new mappings
    if (taskIds && taskIds.length > 0) {
      const dateMap = new Map<number, string | null>();
      if (taskTimelines) {
        taskTimelines.forEach(t => dateMap.set(Number(t.task_id), t.due_date));
      }

      for (const taskId of taskIds) {
        const dueDate = dateMap.get(taskId) || null;
        await this.db.query(
          `INSERT INTO task_set_mapping (task_set_id, task_id, due_date) VALUES ($1, $2, $3)`,
          [id, taskId, dueDate]
        );
      }
    }

    return { mapped: true };
  }

  async mapBranches(id: number, branchIds: number[]) {
    // First clear existing mappings
    await this.db.query(`DELETE FROM task_set_branch WHERE task_set_id = $1`, [id]);

    // Add new mappings
    if (branchIds && branchIds.length > 0) {
      const mappingValues = branchIds.map(branchId => `(${id}, ${branchId})`).join(',');
      await this.db.query(`INSERT INTO task_set_branch (task_set_id, branch_id) VALUES ${mappingValues}`);

      // Immediately generate assignments for the newly mapped units
      try {
        await this.assignmentsScheduler.generateAssignmentsForActiveTaskSets(id);
      } catch (err) {
        console.error(`Error auto-generating assignments for task set ID ${id}:`, err);
      }
    }

    return { mapped: true };
  }

  async reopen(id: number) {
    // 1. Update assignment status and clear review details
    await this.db.query(`
      UPDATE assignment 
      SET status = 'PENDING_RECOMPLIANCE', review_remark = NULL, reviewed_at = NULL
      WHERE task_set_id = $1
    `, [id]);

    // 2. Reset status, completed_at, compliance_status, remarks, and review_status for all tasks of these assignments
    await this.db.query(`
      UPDATE assignment_task
      SET status = 'PENDING', completed_at = NULL, compliance_status = 'PENDING', remarks = NULL, review_status = NULL
      WHERE assignment_id IN (
        SELECT id FROM assignment WHERE task_set_id = $1
      )
    `, [id]);

    return { reopened: true };
  }

  private parseDayOfWeek(day: string): number | null {
    if (!day) return null;
    const d = String(day).toLowerCase().trim().substring(0, 3);
    const days: { [key: string]: number } = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const result = days[d];
    return result !== undefined ? result : null;
  }

  /** Map human-readable frequency label to DB numeric code */
  private mapFrequencyToCode(freq: string): string {
    const map: { [key: string]: string } = {
      'DAILY': '0',
      'WEEKLY': '7',
      'FORTNIGHTLY': '1',
      'FORTNIGHT': '1',
      'MONTHLY': '2',
      'QUARTERLY': '3',
      'SEMI-ANNUALLY': '4',
      'SEMIANNUALLY': '4',
      'HALF-YEARLY': '4',
      'YEARLY': '5',
      'ANNUAL': '5',
      'ANNUALLY': '5',
      'ONCE': '6',
      '1-TIME': '6',
      '1 TIME USE': '6',
    };
    return map[freq.toUpperCase().trim()] ?? freq;
  }

  private parseDateString(dateStr: string): Date | null {
    if (!dateStr) return null;
    const trimmed = String(dateStr).trim();
    // try to match dd-mm-yyyy
    const parts = trimmed.split('-');
    if (parts.length === 3) {
      const parsed = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
      if (!isNaN(parsed.getTime())) return parsed;
    }
    const fallback = new Date(trimmed);
    return isNaN(fallback.getTime()) ? null : fallback;
  }

  private async resolveAuthority(name: string): Promise<number | null> {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    const res = await this.db.query(`SELECT id FROM authority WHERE name ILIKE $1`, [trimmed]);
    if (res.rows.length > 0) return res.rows[0].id;
    const insertRes = await this.db.query(`INSERT INTO authority (name) VALUES ($1) RETURNING id`, [trimmed]);
    return insertRes.rows[0].id;
  }

  private async resolveTaskHeader(name: string): Promise<number | null> {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    const res = await this.db.query(`SELECT id FROM task_header WHERE name ILIKE $1`, [trimmed]);
    if (res.rows.length > 0) return res.rows[0].id;
    const insertRes = await this.db.query(`INSERT INTO task_header (name) VALUES ($1) RETURNING id`, [trimmed]);
    return insertRes.rows[0].id;
  }

  private async resolveBranch(name: string, entityType?: string): Promise<number | null> {
    const trimmed = String(name || '').trim();
    if (!trimmed) return null;
    // Normalize type: 'department' -> 'DEPARTMENT', 'branch' -> 'BRANCH', default 'BRANCH'
    const normalizedType = entityType
      ? String(entityType).trim().toUpperCase() === 'DEPARTMENT' ? 'DEPARTMENT' : 'BRANCH'
      : 'BRANCH';
    const res = await this.db.query(`SELECT id FROM branch_dept WHERE name ILIKE $1`, [trimmed]);
    if (res.rows.length > 0) return res.rows[0].id;
    const insertRes = await this.db.query(
      `INSERT INTO branch_dept (name, type) VALUES ($1, $2) RETURNING id`,
      [trimmed, normalizedType]
    );
    return insertRes.rows[0].id;
  }

  async processBulkUpload(buffer: Buffer) {
    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    // Use raw: false so Excel auto-parses dates as JS Date objects
    const data = xlsx.utils.sheet_to_json(sheet, { raw: false }) as any[];

    if (!data || data.length === 0) return { created: 0 };

    // Group rows by set_name, preserving insertion order
    const grouped = new Map<string, any[]>();
    for (const row of data) {
      const setName = String(row['set_name'] || '').trim();
      if (!setName) continue;
      if (!grouped.has(setName)) grouped.set(setName, []);
      grouped.get(setName)!.push(row);
    }

    const createdSets: any[] = [];

    for (const [setName, rows] of grouped.entries()) {
      // Use the FIRST row to get task-set level settings
      // (frequency, start_date, due, reporting, authority are set-level)
      const firstRow = rows[0];

      // Resolve authority from first row
      let authorityId: number | null = null;
      if (firstRow['authority']) {
        authorityId = await this.resolveAuthority(firstRow['authority']);
      }

      // Map text frequency (DAILY/WEEKLY/etc.) → DB numeric code ('0'/'7'/etc.)
      const frequencyRaw = String(firstRow['frequency'] || 'DAILY').trim();
      const frequencyCode = this.mapFrequencyToCode(frequencyRaw);

      // Parse start_date
      let startDate: Date | null = null;
      const sdVal = firstRow['start_date'];
      if (sdVal) {
        // xlsx with raw:false returns dates as formatted strings
        startDate = this.parseDateString(String(sdVal));
      }

      const dueVal = firstRow['due'];
      const reportingVal = firstRow['reporting'];
      const dueStr = dueVal !== undefined && dueVal !== null ? String(dueVal).trim() : '';
      const reportingStr = reportingVal !== undefined && reportingVal !== null ? String(reportingVal).trim() : '';

      const taskSetPayload: any = {
        name: setName,
        type: 'INTERNAL',
        frequency: frequencyCode,
        start_date: startDate,
        authority_id: authorityId,
        assignment_time: null,
        due_time: null,
        reporting_time: null,
        assignment_day_of_week: null,
        due_day_of_week: null,
        reporting_day_of_week: null,
        assignment_days_of_month: null,
        due_days_of_month: null,
        reporting_days_of_month: null,
        assignment_schedule: null,
        due_schedule: null,
        reporting_schedule: null,
        default_due_date: null,
        reporting_date: null,
        end_date: firstRow['end_date'] ? this.parseDateString(String(firstRow['end_date'])) : null,
      };

      // Populate schedule fields based on frequency
      const freqKey = frequencyRaw.toUpperCase().trim();
      if (freqKey === 'DAILY') {
        taskSetPayload.due_time = dueStr || null;
        taskSetPayload.reporting_time = reportingStr || null;
      } else if (freqKey === 'WEEKLY') {
        // parseDayOfWeek can return 0 (Sunday), handle carefully
        const dDow = this.parseDayOfWeek(dueStr);
        const rDow = this.parseDayOfWeek(reportingStr);
        taskSetPayload.due_day_of_week = dDow !== null ? dDow : null;
        taskSetPayload.reporting_day_of_week = rDow !== null ? rDow : null;
      } else if (freqKey === 'MONTHLY' || freqKey === 'FORTNIGHTLY' || freqKey === 'FORTNIGHT') {
        taskSetPayload.due_days_of_month = dueStr || null;
        taskSetPayload.reporting_days_of_month = reportingStr || null;
      } else if (['QUARTERLY', 'SEMI-ANNUALLY', 'SEMIANNUALLY', 'HALF-YEARLY', 'YEARLY', 'ANNUAL', 'ANNUALLY'].includes(freqKey)) {
        taskSetPayload.due_schedule = dueStr || null;
        taskSetPayload.reporting_schedule = reportingStr || null;
      } else if (freqKey === 'ONCE' || freqKey === '1-TIME' || freqKey === '1 TIME USE') {
        // 1-time use: due/reporting are dates
        taskSetPayload.default_due_date = dueStr ? this.parseDateString(dueStr) : null;
        taskSetPayload.reporting_date = reportingStr ? this.parseDateString(reportingStr) : null;
      }

      const tsResult = await this.db.query(`
        INSERT INTO task_set (
          name, type, frequency, start_date, end_date, authority_id,
          assignment_time, due_time, reporting_time,
          assignment_day_of_week, due_day_of_week, reporting_day_of_week,
          assignment_days_of_month, due_days_of_month, reporting_days_of_month,
          assignment_schedule, due_schedule, reporting_schedule,
          default_due_date, reporting_date
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        RETURNING id
      `, [
        taskSetPayload.name,
        taskSetPayload.type,
        taskSetPayload.frequency,
        taskSetPayload.start_date,
        taskSetPayload.end_date,
        taskSetPayload.authority_id,
        taskSetPayload.assignment_time,
        taskSetPayload.due_time,
        taskSetPayload.reporting_time,
        taskSetPayload.assignment_day_of_week,
        taskSetPayload.due_day_of_week,
        taskSetPayload.reporting_day_of_week,
        taskSetPayload.assignment_days_of_month,
        taskSetPayload.due_days_of_month,
        taskSetPayload.reporting_days_of_month,
        taskSetPayload.assignment_schedule,
        taskSetPayload.due_schedule,
        taskSetPayload.reporting_schedule,
        taskSetPayload.default_due_date,
        taskSetPayload.reporting_date,
      ]);

      const taskSetId: number = tsResult.rows[0].id;

      // Track unique branches per set
      const branchIdsToAssign = new Set<number>();
      const taskIdsToMap: number[] = [];

      for (const row of rows) {
        // Each task can have its own authority (fallback to set-level)
        let rowAuthId = authorityId;
        if (row['authority']) {
          const rowAuthName = String(row['authority']).trim();
          if (!firstRow['authority'] || rowAuthName.toLowerCase() !== String(firstRow['authority']).trim().toLowerCase()) {
            rowAuthId = await this.resolveAuthority(rowAuthName);
          }
        }

        // Resolve task_header per row
        let headerId: number | null = null;
        if (row['task_header']) {
          headerId = await this.resolveTaskHeader(row['task_header']);
        }

        // Create the compliance task
        const taskRes = await this.db.query(`
          INSERT INTO compliance_task (description, header_id, authority_id, is_approved, status, priority)
          VALUES ($1, $2, $3, true, 'APPROVED', $4)
          RETURNING id
        `, [
          String(row['task_name'] || '').trim(),
          headerId,
          rowAuthId,
          String(row['priority'] || 'MEDIUM').toUpperCase(),
        ]);
        taskIdsToMap.push(taskRes.rows[0].id);

        // Collect branch from each row, using for_branch_or_department if provided
        if (row['department_branch_name']) {
          const branchId = await this.resolveBranch(row['department_branch_name'], row['for_branch_or_department']);
          if (branchId !== null) branchIdsToAssign.add(branchId);
        }
      }

      // Map tasks → task set
      if (taskIdsToMap.length > 0) {
        for (const taskId of taskIdsToMap) {
          await this.db.query(
            `INSERT INTO task_set_mapping (task_set_id, task_id) VALUES ($1, $2)`,
            [taskSetId, taskId]
          );
        }
      }

      // Map branches → task set and auto-generate assignments
      const branchArray = Array.from(branchIdsToAssign);
      if (branchArray.length > 0) {
        const mappingValues = branchArray.map(bId => `(${taskSetId}, ${bId})`).join(',');
        await this.db.query(`INSERT INTO task_set_branch (task_set_id, branch_id) VALUES ${mappingValues}`);
        try {
          await this.assignmentsScheduler.generateAssignmentsForActiveTaskSets(taskSetId);
        } catch (err) {
          console.error(`Bulk upload: error auto-generating assignments for task set ID ${taskSetId}:`, err);
        }
      }

      createdSets.push({ id: taskSetId, name: setName, tasks: taskIdsToMap.length, branches: branchArray.length });
    }

    return { success: true, created: createdSets.length, sets: createdSets };
  }

  private excelTimeToHHMM(excelTime: number): string {
    const totalSeconds = Math.round(excelTime * 86400);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
}
