import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as xlsx from 'xlsx';
import { DatabaseService } from '../../core/database/database.service';

@Injectable()
export class TasksService {
  constructor(private readonly db: DatabaseService) {}

  async findAllPaginated(params: { page: number; limit: number; status?: string; circularId?: number; search?: string }) {
    const { page, limit, status, circularId, search } = params;
    const offset = (page - 1) * limit;

    let conditions = ['ct.is_discarded = FALSE'];
    const values: any[] = [];
    let paramIndex = 1;

    if (status === 'Pending') {
      conditions.push(`ct.is_approved = FALSE`);
    } else if (status === 'Approved') {
      conditions.push(`ct.is_approved = TRUE`);
    }

    if (circularId) {
      conditions.push(`ct.circular_id = $${paramIndex++}`);
      values.push(circularId);
    }

    if (search) {
      conditions.push(`(ct.description ILIKE $${paramIndex} OR c.title ILIKE $${paramIndex} OR a.name ILIKE $${paramIndex})`);
      values.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countQuery = `
      SELECT COUNT(*)
      FROM compliance_task ct
      LEFT JOIN circular c ON ct.circular_id = c.id
      LEFT JOIN authority a ON c.authority_id = a.id
      ${whereClause}
    `;
    const countResult = await this.db.query(countQuery, values);
    const total = parseInt(countResult.rows[0].count, 10);

    const query = `
      SELECT ct.*, c.title as circular_title, a.name as authority_name, th.name as header_name
      FROM compliance_task ct
      LEFT JOIN circular c ON ct.circular_id = c.id
      LEFT JOIN authority a ON c.authority_id = a.id
      LEFT JOIN task_header th ON ct.header_id = th.id
      ${whereClause}
      ORDER BY ct.id DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    
    values.push(limit, offset);
    const result = await this.db.query(query, values);

    return {
      data: result.rows,
      total,
      page,
      limit
    };
  }

  async approve(id: number) {
    const query = `
      UPDATE compliance_task
      SET is_approved = TRUE,
          status = 'APPROVED'
      WHERE id = $1
      RETURNING *
    `;
    const result = await this.db.query(query, [id]);
    if (result.rowCount === 0) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }
    return result.rows[0];
  }

  async approveAll(circularId?: number) {
    let query = `
      UPDATE compliance_task
      SET is_approved = TRUE,
          status = 'APPROVED'
      WHERE is_discarded = FALSE AND is_approved = FALSE
    `;
    const params: any[] = [];
    if (circularId) {
      query += ` AND circular_id = $1`;
      params.push(circularId);
    }
    query += ` RETURNING *`;
    const result = await this.db.query(query, params);
    return { count: result.rowCount, approvedTasks: result.rows };
  }


  async getStats(circularId?: number) {
    let whereClause = 'WHERE is_discarded = FALSE';
    const values: any[] = [];
    if (circularId) {
      whereClause += ' AND circular_id = $1';
      values.push(circularId);
    }
    const totalQuery = `SELECT COUNT(*) FROM compliance_task ${whereClause}`;
    const pendingQuery = `SELECT COUNT(*) FROM compliance_task ${whereClause} AND is_approved = FALSE`;
    const approvedQuery = `SELECT COUNT(*) FROM compliance_task ${whereClause} AND is_approved = TRUE`;

    const [totalRes, pendingRes, approvedRes] = await Promise.all([
      this.db.query(totalQuery, values),
      this.db.query(pendingQuery, values),
      this.db.query(approvedQuery, values),
    ]);

    return {
      total: parseInt(totalRes.rows[0].count, 10),
      pending: parseInt(pendingRes.rows[0].count, 10),
      approved: parseInt(approvedRes.rows[0].count, 10),
    };
  }

  async createManual(
    description: string,
    circularId?: number | null,
    headerId?: number,
    priority?: string,
    riskCategory?: string,
    businessRisk?: string,
    controlRisk?: string,
    auditAreaId?: number,
    fileUrl?: string,
    authorityId?: number | null
  ) {
    const res = await this.db.query(
      `INSERT INTO compliance_task (description, circular_id, header_id, is_approved, status, priority, risk_category, business_risk, control_risk, audit_area_id, file_url, authority_id) 
       VALUES ($1, $2, $3, true, 'APPROVED', $4, $5, $6, $7, $8, $9, $10) 
       RETURNING *`,
      [
        description,
        circularId || null,
        headerId || null,
        priority || null,
        riskCategory || null,
        businessRisk || null,
        controlRisk || null,
        auditAreaId || null,
        fileUrl || null,
        authorityId || null
      ],
    );
    return res.rows[0];
  }

  async update(
    id: number,
    description: string,
    headerId?: number,
    priority?: string,
    riskCategory?: string,
    businessRisk?: string,
    controlRisk?: string,
    auditAreaId?: number,
    fileUrl?: string
  ) {
    const res = await this.db.query(
      `UPDATE compliance_task 
       SET description = $1, 
           header_id = $2, 
           priority = $3, 
           risk_category = $4, 
           business_risk = $5, 
           control_risk = $6, 
           audit_area_id = $7, 
           file_url = CASE 
                        WHEN $8::text = '__REMOVE__' THEN NULL 
                        WHEN $8::text IS NOT NULL AND $8::text != '' THEN $8::text 
                        ELSE file_url 
                      END, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $9 RETURNING *`,
      [description, headerId || null, priority || null, riskCategory || null, businessRisk || null, controlRisk || null, auditAreaId || null, fileUrl !== undefined ? fileUrl : null, id],
    );
    if (res.rowCount === 0) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }
    return res.rows[0];
  }

  async createBulk(circularId: number, tasks: { description: string }[]) {
    const results: any[] = [];
    for (const t of tasks) {
      const res = await this.createManual(t.description, circularId);
      results.push(res);
    }
    return results;
  }

  /**
   * Process Bulk Upload from XLSX / XLS / CSV file buffer
   */
  async processBulkUpload(buffer: Buffer, defaultCircularId?: number) {
    let workbook: xlsx.WorkBook;
    try {
      workbook = xlsx.read(buffer, { type: 'buffer' });
    } catch (err: any) {
      throw new BadRequestException('Failed to parse Excel/CSV file: ' + (err.message || 'Invalid format'));
    }

    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new BadRequestException('The uploaded workbook contains no sheets.');
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rawRows: any[] = xlsx.utils.sheet_to_json(sheet, { defval: '' });

    if (!rawRows || rawRows.length === 0) {
      throw new BadRequestException('The uploaded sheet contains no data rows.');
    }

    // Helper function to normalize keys
    const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

    return this.db.transaction(async (client) => {
      // Fetch existing headers
      const headersRes = await client.query('SELECT id, name, parent_id FROM task_header');
      const headersList = headersRes.rows;

      // Find or create headers helper
      const headerCache: { [key: string]: number } = {};
      headersList.forEach(h => {
        headerCache[h.name.trim().toLowerCase()] = h.id;
      });

      const findRootHeaderId = (name?: string) => {
        if (!name) return headersList.find(h => !h.parent_id)?.id || null;
        const root = headersList.find(h => !h.parent_id && h.name.trim().toLowerCase() === name.trim().toLowerCase());
        return root ? root.id : (headersList.find(h => !h.parent_id)?.id || null);
      };

      const insertedTasks: any[] = [];
      const errors: string[] = [];

      for (let i = 0; i < rawRows.length; i++) {
        const row = rawRows[i];
        const rowNum = i + 2; // considering 1-based index + header row

        // Map columns dynamically
        let description = '';
        let headerName = '';
        let mainHeaderName = '';
        let priority = 'Medium';
        let riskCategory = '';
        let businessRisk = '';
        let controlRisk = '';
        let circularId: number | null = defaultCircularId || null;
        let authorityId: number | null = null;

        for (const [k, v] of Object.entries(row)) {
          const normK = normalizeKey(k);
          const valStr = String(v || '').trim();

          if (normK.includes('description') || normK.includes('particular') || normK === 'task' || normK === 'taskname') {
            description = valStr;
          } else if (normK.includes('subheader') || normK === 'header' || normK === 'headername' || normK === 'category') {
            headerName = valStr;
          } else if (normK.includes('mainheader') || normK === 'domain' || normK === 'module') {
            mainHeaderName = valStr;
          } else if (normK.includes('priority')) {
            priority = valStr || 'Medium';
          } else if (normK.includes('riskcategory') || normK === 'risk') {
            riskCategory = valStr;
          } else if (normK.includes('businessrisk') || normK.includes('rowcode') || normK.includes('remarks') || normK === 'notes') {
            businessRisk = valStr;
          } else if (normK.includes('controlrisk')) {
            controlRisk = valStr;
          } else if (normK.includes('circularid') || normK === 'circular') {
            if (valStr && !isNaN(Number(valStr))) circularId = Number(valStr);
          } else if (normK.includes('authorityid') || normK === 'authority') {
            if (valStr && !isNaN(Number(valStr))) authorityId = Number(valStr);
          }
        }

        const descLower = description.toLowerCase();
        if (
          !description ||
          descLower.startsWith('total') ||
          descLower.startsWith('subtotal') ||
          descLower.startsWith('grand total') ||
          [
            'scoring chart & grade',
            'categories',
            'info sec processes & controls',
            'governance & policy',
            'vendor management',
            'cyber crisis management',
            'grading',
            'particular',
            'particulars',
            'sr. no.',
            'sr no',
            'description',
            'parameter',
            'parameters'
          ].includes(descLower)
        ) {
          continue;
        }

        // Determine header_id
        let headerId: number | null = null;
        if (headerName) {
          const cacheKey = headerName.toLowerCase();
          if (headerCache[cacheKey]) {
            headerId = headerCache[cacheKey];
          } else {
            // Auto-create sub-header under main header
            const rootParentId = findRootHeaderId(mainHeaderName);
            const createHeaderRes = await client.query(`
              INSERT INTO task_header (name, parent_id)
              VALUES ($1, $2)
              RETURNING id, name
            `, [headerName, rootParentId]);
            headerId = createHeaderRes.rows[0].id;
            headerCache[cacheKey] = headerId;
          }
        }

        try {
          const insertRes = await client.query(`
            INSERT INTO compliance_task (
              description, header_id, is_approved, status, is_discarded,
              priority, risk_category, business_risk, control_risk,
              circular_id, authority_id
            ) VALUES ($1, $2, true, 'APPROVED', false, $3, $4, $5, $6, $7, $8)
            RETURNING *
          `, [
            description,
            headerId,
            priority,
            riskCategory || (mainHeaderName || null),
            businessRisk || null,
            controlRisk || null,
            circularId,
            authorityId || 1
          ]);

          insertedTasks.push(insertRes.rows[0]);
        } catch (dbErr: any) {
          errors.push(`Row ${rowNum}: ${dbErr.message || 'Database error occurred'}`);
        }
      }

      return {
        totalRows: rawRows.length,
        successCount: insertedTasks.length,
        errorCount: errors.length,
        errors,
        data: insertedTasks
      };
    });
  }

  /**
   * Generate an Excel Template (.xlsx) for bulk uploading tasks
   */
  generateBulkUploadTemplate(): Buffer {
    const wb = xlsx.utils.book_new();

    const headers = [
      'Task Description*',
      'Main Header',
      'Sub Header',
      'Priority',
      'Risk Category',
      'Business Risk',
      'Control Risk',
      'Circular ID'
    ];

    const sampleRows = [
      [
        'Whether all IT Assets (both hardware and software) have been inventoried?',
        'IT Governance & Cybersecurity',
        'IT Asset Management',
        'High',
        'Cyber Security',
        'Asset inventory tracking compliance',
        'Low',
        ''
      ],
      [
        'Whether Firewall is configured in Boundary defence?',
        'IT Legal & Regulatory Compliance',
        'Level II - Network Management and Security',
        'High',
        'Network Security',
        'Boundary security protection',
        'Medium',
        ''
      ],
      [
        'Whether the Bank is providing Unified Payment Interface (UPI) Services?',
        'IT Operations & Security',
        'Level of Exposure',
        'Medium',
        'Payment Systems',
        'Digital banking channel compliance',
        'Low',
        ''
      ]
    ];

    const sheetData = [headers, ...sampleRows];
    const ws = xlsx.utils.aoa_to_sheet(sheetData);

    // Set column widths
    ws['!cols'] = [
      { wch: 60 }, // Task Description
      { wch: 30 }, // Main Header
      { wch: 35 }, // Sub Header
      { wch: 15 }, // Priority
      { wch: 20 }, // Risk Category
      { wch: 35 }, // Business Risk
      { wch: 15 }, // Control Risk
      { wch: 15 }  // Circular ID
    ];

    xlsx.utils.book_append_sheet(wb, ws, 'Tasks Template');
    return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }
}
