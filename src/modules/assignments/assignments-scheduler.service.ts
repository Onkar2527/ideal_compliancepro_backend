import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../../core/database/database.service';
import { HolidaysService } from '../holidays/holidays.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class AssignmentsSchedulerService {
  private readonly logger = new Logger(AssignmentsSchedulerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly holidaysService: HolidaysService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  // Run every night at midnight (00:00)
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyAssignmentGeneration() {
    this.logger.log('Starting daily auto-generation of compliance assignments...');
    await this.generateAssignmentsForActiveTaskSets();
    this.logger.log('Daily auto-generation completed.');
  }

  // Truncate all previous assignments and re-run assignment generation
  async resetAndRegenerateAssignments(): Promise<{ truncated: boolean; generated: number; skipped: number }> {
    this.logger.log('Truncating all previous assignment records...');
    await this.db.query(`TRUNCATE TABLE assignment CASCADE`);
    this.logger.log('All previous assignments truncated successfully.');

    this.logger.log('Re-running assignment generation for all active task sets...');
    const result = await this.generateAssignmentsForActiveTaskSets();
    this.logger.log(`Re-generation completed: ${JSON.stringify(result)}`);
    return { truncated: true, ...result };
  }

  // Business logic to run calculation and generation
  async generateAssignmentsForActiveTaskSets(specificTaskSetId?: number): Promise<{ generated: number; skipped: number }> {
    let query = `
      SELECT id, name, default_due_date, start_date, end_date, frequency, reporting_date, type,
             due_time, reporting_time, due_day_of_week, reporting_day_of_week,
             due_days_of_month, reporting_days_of_month, due_schedule, reporting_schedule
      FROM task_set
      WHERE 1=1
    `;
    const params: any[] = [];

    if (specificTaskSetId) {
      query += ` AND id = $1`;
      params.push(specificTaskSetId);
    } else {
      // Find task sets that are currently active
      query += ` AND (start_date IS NULL OR start_date <= CURRENT_DATE)
                 AND (end_date IS NULL OR end_date >= CURRENT_DATE)`;
    }

    const taskSetsResult = await this.db.query(query, params);
    const taskSets = taskSetsResult.rows;

    let generatedCount = 0;
    let skippedCount = 0;

    for (const ts of taskSets) {
      // Get all branches mapped to this task set
      const branchesResult = await this.db.query(
        `SELECT branch_id FROM task_set_branch WHERE task_set_id = $1`,
        [ts.id]
      );
      const branchIds = branchesResult.rows.map(r => r.branch_id);

      if (branchIds.length === 0) {
        this.logger.warn(`Task set "${ts.name}" (ID: ${ts.id}) has no assigned branches. Skipping.`);
        continue;
      }

      // Calculate period, assignment date, and due date
      let { periodStart, periodEnd, assignmentDate, dueDate } = this.calculatePeriodAndDueDate(ts);

      const today = new Date().toISOString().split('T')[0];

      // Skip future assignments. If it's today or in the past, let it generate (it won't duplicate because of the EXISTS check below).
      if (assignmentDate > today) {
        this.logger.log(
          `Skipping task set "${ts.name}" (ID: ${ts.id}): assignment date is ${assignmentDate}, today is ${today}.`
        );
        skippedCount++;
        continue;
      }

      // Holiday check on the DUE date — shift forward if it falls on a holiday
      const isHol = await this.holidaysService.isHoliday(dueDate);
      if (isHol) {
        if (String(ts.frequency).trim() === '0') {
          this.logger.log(`Skipping daily task set "${ts.name}" (ID: ${ts.id}) because due date ${dueDate} is a holiday.`);
          skippedCount++;
          continue;
        } else {
          let nextWorkingDate = new Date(dueDate);
          while (await this.holidaysService.isHoliday(nextWorkingDate.toISOString().split('T')[0])) {
            nextWorkingDate.setDate(nextWorkingDate.getDate() + 1);
          }
          dueDate = nextWorkingDate.toISOString().split('T')[0];
          this.logger.log(`Shifted due date for task set "${ts.name}" to ${dueDate} because original date was a holiday.`);
        }
      }

      this.logger.log(
        `Processing task set "${ts.name}" (ID: ${ts.id}): Period ${periodStart} to ${periodEnd}, Assignment ${assignmentDate}, Due ${dueDate}`
      );

      const isInternal = (ts.type || '').toUpperCase() === 'INTERNAL';
      const initialStatus = 'In_Progress';
      const freq = ts.frequency ? String(ts.frequency).trim() : '6';

      for (const branchId of branchIds) {
        // Check if assignment already exists for this branch in the current frequency cycle
        // For One-Time ('6'), check if ANY assignment exists for (task_set_id, branch_id)
        // For recurring frequencies, check if an assignment exists where created_at or proposed_timeline falls within [periodStart, periodEnd]
        const checkResult = await this.db.query(
          `SELECT id FROM assignment 
           WHERE task_set_id = $1 
             AND branch_id = $2 
             AND (
               $5 = '6'
               OR (created_at::DATE >= $3::DATE AND created_at::DATE <= $4::DATE)
               OR (proposed_timeline >= $3::DATE AND proposed_timeline <= $4::DATE)
             )`,
          [ts.id, branchId, periodStart, periodEnd, freq]
        );

        if (checkResult.rows.length > 0) {
          this.logger.log(
            `Skipping assignment for task set "${ts.name}" (ID: ${ts.id}), branch ID ${branchId}: already assigned for cycle ${periodStart} to ${periodEnd}`
          );
          skippedCount++;
          continue;
        }

        // Create assignment record with due date as proposed_timeline
        const insertRes = await this.db.query(
          `INSERT INTO assignment (task_set_id, branch_id, proposed_timeline, status)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [ts.id, branchId, dueDate, initialStatus]
        );
        const newAssignmentId = insertRes.rows[0].id;

        // Populate assignment_task mapping table
        await this.db.query(
          `INSERT INTO assignment_task (assignment_id, task_id, status, due_date, proposed_due_date)
           SELECT $1, tsm.task_id, 'PENDING', COALESCE(tsm.due_date, $3::DATE), NULL
           FROM task_set_mapping tsm
           WHERE tsm.task_set_id = $2`,
          [newAssignmentId, ts.id, dueDate]
        );

        this.eventEmitter.emit('assignment.updated', {
          assignmentId: newAssignmentId,
          status: 'NEW_ASSIGNMENT',
          branchId: branchId,
          taskSetName: ts.name,
        });

        generatedCount++;
      }
    }

    return { generated: generatedCount, skipped: skippedCount };
  }

  // Calculate start/end dates of current compliance period, assignment date, and due date
  calculatePeriodAndDueDate(ts: any, refDate: Date = new Date()) {
    const y = refDate.getFullYear();
    const m = refDate.getMonth(); // 0-indexed
    const d = refDate.getDate();

    let periodStart: Date;
    let periodEnd: Date;
    let dueDate: Date;
    // assignmentDate = the date on which the assignment SHOULD BE GENERATED
    let assignmentDate: Date;

    // Extracts the first valid day number (1-31) from a text like "15 Jan", "1, 15", "28th"
    const extractDay = (str: string | null): number | null => {
      if (!str) return null;
      const matches = str.match(/\d+/g);
      if (!matches) return null;
      for (const num of matches) {
        const day = parseInt(num, 10);
        if (day > 0 && day <= 31) return day;
      }
      return null;
    };

    // Extracts the month number from a text like "15 Jan", "Feb 28"
    const extractMonth = (str: string | null): number | null => {
      if (!str) return null;
      const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const lower = str.toLowerCase();
      for (let i = 0; i < monthNames.length; i++) {
        if (lower.includes(monthNames[i])) return i; // 0-indexed month
      }
      return null;
    };

    const freq = ts.frequency ? String(ts.frequency).trim() : '6';

    // Assignment schedule fields (when to generate)
    const assignDay   = extractDay(ts.assignment_days_of_month)
                     || extractDay(ts.assignment_schedule)
                     || ts.assignment_day_of_week
                     || null;

    // Due schedule fields (deadline)
    const dueDay      = extractDay(ts.due_days_of_month)
                     || extractDay(ts.due_schedule)
                     || null;

    switch (freq) {
      case '0': // DAILY
        periodStart    = new Date(y, m, d);
        periodEnd      = new Date(y, m, d);
        assignmentDate = new Date(y, m, d);
        dueDate        = new Date(y, m, d);
        break;

      case '7': // WEEKLY
        // day_of_week: 1=Mon … 7=Sun (JS: 0=Sun…6=Sat)
        const assignDow = ts.assignment_day_of_week ?? 1;
        const dueDow    = ts.due_day_of_week ?? assignDow;
        // Find the Monday of the current week
        const dayOfWeek = refDate.getDay() || 7; // convert Sunday(0) to 7
        const weekStart = new Date(y, m, d - dayOfWeek + 1);
        periodStart    = weekStart;
        periodEnd      = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
        assignmentDate = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + assignDow - 1);
        dueDate        = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + dueDow - 1);
        break;

      case '1': // FORTNIGHT
        const isFirstHalf = d <= 15;
        if (isFirstHalf) {
          periodStart    = new Date(y, m, 1);
          periodEnd      = new Date(y, m, 15);
          assignmentDate = new Date(y, m, Math.min(assignDay ?? 1, 15));
          dueDate        = new Date(y, m, Math.min(dueDay ?? 13, 15));
        } else {
          periodStart    = new Date(y, m, 16);
          periodEnd      = new Date(y, m + 1, 0);
          const lastDay  = periodEnd.getDate();
          assignmentDate = new Date(y, m, Math.min(assignDay ?? 16, lastDay));
          dueDate        = new Date(y, m, Math.min(dueDay ?? 27, lastDay));
        }
        break;

      case '2': // MONTHLY
        periodStart    = new Date(y, m, 1);
        periodEnd      = new Date(y, m + 1, 0);
        assignmentDate = new Date(y, m, assignDay ?? 1);
        dueDate        = new Date(y, m, dueDay ?? 27);
        break;

      case '3': { // QUARTERLY
        const quarter  = Math.floor(m / 3);
        const qStart   = quarter * 3;
        periodStart    = new Date(y, qStart, 1);
        periodEnd      = new Date(y, qStart + 3, 0);
        const dMonth   = extractMonth(ts.due_schedule);
        dueDate        = new Date(y, dMonth != null ? dMonth : qStart + 2, dueDay ?? 27);

        let aMonth = extractMonth(ts.assignment_schedule);
        const aStr = (ts.assignment_schedule || '').toLowerCase();
        if (aMonth == null && (aStr.includes('same') || aStr.includes('due') || aStr.includes('month') || !ts.assignment_schedule)) {
            aMonth = dueDate.getMonth();
        }
        
        let aYear = y;
        if (aMonth != null && aMonth < qStart) {
            aYear = y + 1;
        }

        assignmentDate = new Date(aYear, aMonth != null ? aMonth : qStart, assignDay ?? 1);
        break;
      }

      case '4': { // SEMI-ANNUAL
        const half     = Math.floor(m / 6);
        const hStart   = half * 6;
        periodStart    = new Date(y, hStart, 1);
        periodEnd      = new Date(y, hStart + 6, 0);
        const dMonth   = extractMonth(ts.due_schedule);
        dueDate        = new Date(y, dMonth != null ? dMonth : hStart + 5, dueDay ?? 27);

        let aMonth = extractMonth(ts.assignment_schedule);
        const aStr = (ts.assignment_schedule || '').toLowerCase();
        if (aMonth == null && (aStr.includes('same') || aStr.includes('due') || aStr.includes('month') || !ts.assignment_schedule)) {
            aMonth = dueDate.getMonth();
        }
        
        // Ensure that if the assignment is meant to be in the same month as due date, it actually takes the correct year
        let aYear = y;
        if (aMonth != null && aMonth < hStart) {
            aYear = y + 1; // if it shifted to next year somehow
        }

        assignmentDate = new Date(aYear, aMonth != null ? aMonth : hStart, assignDay ?? 1);
        break;
      }

      case '5': { // YEARLY
        periodStart    = new Date(y, 0, 1);
        periodEnd      = new Date(y, 11, 31);
        const dMonth   = extractMonth(ts.due_schedule) ?? 11;
        dueDate        = new Date(y, dMonth, dueDay ?? 27);

        let aMonth = extractMonth(ts.assignment_schedule);
        const aStr = (ts.assignment_schedule || '').toLowerCase();
        if (aMonth == null && (aStr.includes('same') || aStr.includes('due') || aStr.includes('month') || !ts.assignment_schedule)) {
            aMonth = dueDate.getMonth();
        }
        assignmentDate = new Date(y, aMonth != null ? aMonth : dMonth, assignDay ?? 1);
        break;
      }

      case '6': // ONE-TIME
      default:
        periodStart    = ts.start_date ? new Date(ts.start_date) : new Date(y, m, d);
        periodEnd      = new Date(y + 1, m, d);
        assignmentDate = ts.start_date ? new Date(ts.start_date) : new Date(y, m, d);
        dueDate        = ts.default_due_date ? new Date(ts.default_due_date) : new Date(y, m, d + 30);
        break;
    }

    return {
      periodStart:    periodStart.toISOString().split('T')[0],
      periodEnd:      periodEnd.toISOString().split('T')[0],
      assignmentDate: assignmentDate.toISOString().split('T')[0],
      dueDate:        dueDate.toISOString().split('T')[0],
    };
  }
}

