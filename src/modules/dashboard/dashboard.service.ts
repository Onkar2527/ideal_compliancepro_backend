import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';

@Injectable()
export class DashboardService {
  constructor(private readonly db: DatabaseService) {}

  async getStats(user: any) {
    const rawRole = String(user?.role || '').toUpperCase();
    const userId = user?.sub || user?.id;
    const branchId = user?.branchId ?? user?.branch_id;

    const isCO = rawRole === 'CO' || rawRole === 'CO_USER' || rawRole === 'CO_REVIEWER';
    const isCCO = rawRole === 'CCO';
    const isDeptOrBranch = rawRole === 'BRANCH' || rawRole === 'BRANCH_USER' || rawRole === 'DEPARTMENT';
    const showCoMetrics = (isCO || isCCO || rawRole === 'ADMIN') && !!userId;

    // 1. Check mapping check with fast EXISTS check if CO/CCO
    let hasMapped = false;
    if ((isCO || isCCO) && userId) {
      const col = isCO ? 'co_user_id' : 'cco_user_id';
      const mappedCheck = await this.db.query(
        `SELECT EXISTS (SELECT 1 FROM branch_dept WHERE ${col} = $1) as "exists"`,
        [userId],
      );
      hasMapped = !!mappedCheck.rows[0]?.exists;
    }

    // 2. Build role-specific assignment queries
    let assignmentStatsQuery = `
      SELECT 
        count(*) as total,
        sum(case when UPPER(status) = 'COMPLETED' then 1 else 0 end) as completed,
        sum(case when UPPER(status) = 'IN_PROGRESS' then 1 else 0 end) as in_progress,
        sum(case when UPPER(status) = 'REVIEW_PENDING' then 1 else 0 end) as review_pending,
        sum(case when UPPER(status) = 'PENDING_TIMELINE' then 1 else 0 end) as pending_timeline,
        sum(case when UPPER(status) = 'TIMELINE_REVIEW' then 1 else 0 end) as timeline_review,
        sum(case when UPPER(status) = 'ESCALATED_TO_CCO' then 1 else 0 end) as escalated,
        sum(case when UPPER(status) IN ('REJECTED', 'PENDING_RECOMPLIANCE') then 1 else 0 end) as rejected
      FROM assignment a
    `;
    let assignmentParams: any[] = [];

    let recentAssignmentsQuery = `
      SELECT a.id, a.status, a.proposed_timeline, 
             ts.name as task_set_name, bd.name as branch_name
      FROM assignment a
      JOIN task_set ts ON ts.id = a.task_set_id
      JOIN branch_dept bd ON bd.id = a.branch_id
    `;
    let recentAssignmentsParams: any[] = [];

    if ((isCO || isCCO) && userId && hasMapped) {
      const col = isCO ? 'co_user_id' : 'cco_user_id';
      assignmentStatsQuery += ` JOIN branch_dept bd ON bd.id = a.branch_id WHERE bd.${col} = $1`;
      assignmentParams.push(userId);
      recentAssignmentsQuery += ` WHERE bd.${col} = $1 ORDER BY a.id DESC LIMIT 8`;
      recentAssignmentsParams.push(userId);
    } else if (isDeptOrBranch && branchId) {
      assignmentStatsQuery += ` WHERE a.branch_id = $1`;
      assignmentParams.push(branchId);
      recentAssignmentsQuery += ` WHERE a.branch_id = $1 ORDER BY a.id DESC LIMIT 8`;
      recentAssignmentsParams.push(branchId);
    } else {
      recentAssignmentsQuery += ` ORDER BY a.id DESC LIMIT 8`;
    }

    // 3. Consolidated general counts query (replaces 5 separate queries)
    const generalCountsQuery = `
      SELECT 
        (SELECT count(*) FROM circular) as circular_count,
        (SELECT count(*) FROM task_set) as task_set_count,
        count(*) as branch_dept_count,
        count(*) FILTER (WHERE type = 'BRANCH') as branch_count,
        count(*) FILTER (WHERE type = 'DEPARTMENT') as department_count
      FROM branch_dept
    `;

    // 4. Consolidated task metrics query (replaces 3 separate queries)
    let taskMetricsQuery = '';
    let taskParams: any[] = [];
    if (isDeptOrBranch && branchId) {
      taskMetricsQuery = `
        SELECT 
          count(at.id) as total_tasks,
          count(at.id) FILTER (WHERE UPPER(at.status) = 'PENDING') as pending_tasks,
          count(at.id) FILTER (WHERE UPPER(at.review_status) = 'APPROVED' OR UPPER(at.status) = 'COMPLETED') as approved_tasks
        FROM assignment_task at 
        JOIN assignment a ON at.assignment_id = a.id 
        WHERE a.branch_id = $1
      `;
      taskParams = [branchId];
    } else {
      taskMetricsQuery = `
        SELECT 
          (SELECT count(*) FROM compliance_task) as total_tasks,
          count(*) FILTER (WHERE UPPER(status) = 'PENDING') as pending_tasks,
          count(*) FILTER (WHERE UPPER(review_status) = 'APPROVED' OR UPPER(status) = 'COMPLETED') as approved_tasks
        FROM assignment_task
      `;
    }

    // 5. Consolidated compliance status & overdue query
    const complianceStatusQuery = `
      SELECT 
        count(*) FILTER (WHERE UPPER(status) IN ('ESCALATED_TO_CCO', 'REVIEW_PENDING')) as cco_pending_compliance,
        count(*) FILTER (WHERE UPPER(status) IN ('REVIEW_PENDING', 'TIMELINE_REVIEW', 'ESCALATED_TO_CCO')) as co_pending_compliance,
        (
          SELECT count(at.id) 
          FROM assignment_task at 
          JOIN assignment a ON at.assignment_id = a.id 
          WHERE UPPER(at.status) = 'PENDING' AND at.due_date < CURRENT_DATE AND UPPER(a.status) != 'COMPLETED'
        ) as total_overdue
      FROM assignment
    `;

    // 6. High performance single-pass CTE authority reports query
    const authorityReportsQuery = `
      WITH circular_aggs AS (
        SELECT 
          authority_id,
          count(*) as applicable_circulars,
          COALESCE(sum(penalty_amount) FILTER (WHERE is_penalty_applicable = TRUE), 0) as total_penalty
        FROM circular
        WHERE authority_id IS NOT NULL
        GROUP BY authority_id
      ),
      task_aggs AS (
        SELECT 
          c.authority_id,
          count(at.id) as total_tasks,
          count(at.id) FILTER (WHERE UPPER(at.review_status) = 'APPROVED' OR UPPER(at.status) = 'COMPLETED') as completed_tasks,
          count(at.id) FILTER (WHERE at.status IS NULL OR UPPER(at.status) = 'PENDING') as pending_tasks,
          count(at.id) FILTER (WHERE (at.status IS NULL OR UPPER(at.status) = 'PENDING') AND at.due_date < CURRENT_DATE AND UPPER(assign.status) != 'COMPLETED') as overdue_tasks
        FROM assignment_task at
        JOIN compliance_task ct ON at.task_id = ct.id
        JOIN circular c ON ct.circular_id = c.id
        JOIN assignment assign ON at.assignment_id = assign.id
        WHERE c.authority_id IS NOT NULL
        GROUP BY c.authority_id
      )
      SELECT 
        a.id, 
        a.name,
        COALESCE(ca.applicable_circulars, 0) as applicable_circulars,
        COALESCE(ta.total_tasks, 0) as total_tasks,
        COALESCE(ta.completed_tasks, 0) as completed_tasks,
        COALESCE(ta.pending_tasks, 0) as pending_tasks,
        COALESCE(ta.overdue_tasks, 0) as overdue_tasks,
        COALESCE(ca.total_penalty, 0) as total_penalty
      FROM authority a
      LEFT JOIN circular_aggs ca ON ca.authority_id = a.id
      LEFT JOIN task_aggs ta ON ta.authority_id = a.id
      ORDER BY a.id ASC
    `;

    // 7. Recent circulars
    const recentCircularsQuery = `
      SELECT * FROM (
        SELECT DISTINCT ON (c.title) c.id, c.title, c.published_date, c.pdf_url, a.name as authority_name
        FROM circular c
        JOIN authority a ON a.id = c.authority_id
        ORDER BY c.title, c.id DESC
      ) sub
      ORDER BY sub.id DESC
      LIMIT 5
    `;

    // 8. Shared awaiting action queue query
    const awaitingActionQuery = `
      SELECT 
        a.id as assignment_id,
        ts.name as task_set_name,
        bd.name as branch_name,
        a.status,
        a.proposed_timeline::TEXT as proposed_timeline
      FROM assignment a
      JOIN task_set ts ON ts.id = a.task_set_id
      JOIN branch_dept bd ON bd.id = a.branch_id
      ORDER BY a.id DESC
    `;

    // 9. High performance single-pass CTE branch reports query (only if showCoMetrics)
    const branchReportsQuery = showCoMetrics ? `
      WITH overdue_assignments AS (
        SELECT DISTINCT a.id
        FROM assignment a
        JOIN assignment_task at ON at.assignment_id = a.id
        WHERE UPPER(a.status) != 'COMPLETED'
          AND at.due_date < CURRENT_DATE
          AND UPPER(at.status) = 'PENDING'
      ),
      branch_stats AS (
        SELECT 
          a.branch_id,
          count(*) as total_assignments,
          count(*) FILTER (WHERE UPPER(a.status) = 'COMPLETED') as completed_assignments,
          count(*) FILTER (WHERE UPPER(a.status) IN ('REVIEW_PENDING', 'TIMELINE_REVIEW')) as review_pending_assignments,
          count(*) FILTER (WHERE UPPER(a.status) = 'IN_PROGRESS') as active_assignments,
          count(oa.id) as overdue_assignments
        FROM assignment a
        LEFT JOIN overdue_assignments oa ON oa.id = a.id
        GROUP BY a.branch_id
      )
      SELECT 
        bd.id,
        bd.name,
        bd.type,
        COALESCE(bs.total_assignments, 0) as total_assignments,
        COALESCE(bs.completed_assignments, 0) as completed_assignments,
        COALESCE(bs.review_pending_assignments, 0) as review_pending_assignments,
        COALESCE(bs.active_assignments, 0) as active_assignments,
        COALESCE(bs.overdue_assignments, 0) as overdue_assignments
      FROM branch_dept bd
      LEFT JOIN branch_stats bs ON bs.branch_id = bd.id
      ORDER BY bd.name ASC
    ` : null;

    const authorityStatsQuery = `SELECT a.name, count(c.id) as count FROM authority a LEFT JOIN circular c ON c.authority_id = a.id GROUP BY a.name`;

    // 10. Execute all queries in single parallel Promise.all batch
    const [
      generalCountsRes,
      taskMetricsRes,
      recentCircularsRes,
      assignmentStatsRes,
      recentAssignmentsRes,
      complianceStatusRes,
      authorityReportsRes,
      authorityStatsRes,
      awaitingActionRes,
      branchReportsRes,
    ] = await Promise.all([
      this.db.query(generalCountsQuery),
      this.db.query(taskMetricsQuery, taskParams),
      this.db.query(recentCircularsQuery),
      this.db.query(assignmentStatsQuery, assignmentParams),
      this.db.query(recentAssignmentsQuery, recentAssignmentsParams),
      this.db.query(complianceStatusQuery),
      this.db.query(authorityReportsQuery),
      this.db.query(authorityStatsQuery),
      this.db.query(awaitingActionQuery),
      branchReportsQuery ? this.db.query(branchReportsQuery) : Promise.resolve({ rows: [] } as any),
    ]);

    const genCounts = generalCountsRes.rows[0] || {};
    const taskCounts = taskMetricsRes.rows[0] || {};
    const stats = assignmentStatsRes.rows[0] || {};
    const compStatus = complianceStatusRes.rows[0] || {};

    const totalBranches = parseInt(genCounts.branch_count || '0', 10);
    const totalHeadOffice = parseInt(genCounts.department_count || '0', 10);
    const totalOverdue = parseInt(compStatus.total_overdue || '0', 10);

    let coMetricsData = null;
    if (showCoMetrics) {
      coMetricsData = {
        totalBranches,
        totalHeadOffice,
        pendingCompliance: parseInt(compStatus.co_pending_compliance || '0', 10),
        totalOverdue,
        branchReports: branchReportsRes.rows.map((row: any) => ({
          ...row,
          total_assignments: parseInt(row.total_assignments || '0', 10),
          completed_assignments: parseInt(row.completed_assignments || '0', 10),
          review_pending_assignments: parseInt(row.review_pending_assignments || '0', 10),
          active_assignments: parseInt(row.active_assignments || '0', 10),
          overdue_assignments: parseInt(row.overdue_assignments || '0', 10),
        })),
        awaitingActionQueue: awaitingActionRes.rows,
      };
    }

    const authorityReportsMapped = authorityReportsRes.rows.map((row: any) => ({
      ...row,
      applicable_circulars: parseInt(row.applicable_circulars || '0', 10),
      total_tasks: parseInt(row.total_tasks || '0', 10),
      completed_tasks: parseInt(row.completed_tasks || '0', 10),
      pending_tasks: parseInt(row.pending_tasks || '0', 10),
      overdue_tasks: parseInt(row.overdue_tasks || '0', 10),
      total_penalty: parseFloat(row.total_penalty || '0'),
    }));

    return {
      circulars: parseInt(genCounts.circular_count || '0', 10),
      tasks: parseInt(taskCounts.total_tasks || '0', 10),
      pendingTasks: parseInt(taskCounts.pending_tasks || '0', 10),
      approvedTasks: parseInt(taskCounts.approved_tasks || '0', 10),
      taskSets: parseInt(genCounts.task_set_count || '0', 10),
      branches: parseInt(genCounts.branch_dept_count || '0', 10),
      assignments: {
        total: parseInt(stats.total || '0', 10),
        completed: parseInt(stats.completed || '0', 10),
        inProgress: parseInt(stats.in_progress || '0', 10),
        reviewPending: parseInt(stats.review_pending || '0', 10),
        pendingTimeline: parseInt(stats.pending_timeline || '0', 10),
        timelineReview: parseInt(stats.timeline_review || '0', 10),
        escalated: parseInt(stats.escalated || '0', 10),
        rejected: parseInt(stats.rejected || '0', 10),
      },
      recentCirculars: recentCircularsRes.rows,
      recentAssignments: recentAssignmentsRes.rows,
      authorityStats: authorityStatsRes.rows,
      coMetrics: coMetricsData,
      ccoMetrics: {
        totalBranches,
        totalHeadOffice,
        pendingCompliance: parseInt(compStatus.cco_pending_compliance || '0', 10),
        totalOverdue,
        awaitingActionQueue: awaitingActionRes.rows,
        authorityReports: authorityReportsMapped,
      },
    };
  }
}
