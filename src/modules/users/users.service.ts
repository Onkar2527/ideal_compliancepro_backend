import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import { IdService } from '../../core/id/id.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly idService: IdService,
  ) { }

  async findAll() {
    const query = `
      SELECT 
        u.id, u.username, u.full_name, u.email, u.mobile_number, 
        u.role, 
        u.branch_id, b.name as branch_name,
        u.is_active, u.created_at, u.updated_at,
        CASE 
          WHEN u.role = 'CCO' THEN (SELECT json_agg(bd.id) FROM branch_dept bd WHERE bd.cco_user_id = u.id)
          ELSE (SELECT json_agg(bd.id) FROM branch_dept bd WHERE bd.co_user_id = u.id)
        END as managed_branch_ids
      FROM users u
      LEFT JOIN branch_dept b ON u.branch_id = b.id
      ORDER BY u.id::integer ASC
    `;
    const result = await this.db.query(query);
    return result.rows;
  }

  async findOne(id: string) {
    const query = `
      SELECT u.*, b.name as branch_name,
        CASE 
          WHEN u.role = 'CCO' THEN (SELECT json_agg(bd.id) FROM branch_dept bd WHERE bd.cco_user_id = u.id)
          ELSE (SELECT json_agg(bd.id) FROM branch_dept bd WHERE bd.co_user_id = u.id)
        END as managed_branch_ids
      FROM users u
      LEFT JOIN branch_dept b ON u.branch_id = b.id
      WHERE u.id = $1
    `;
    const result = await this.db.query(query, [id]);
    return result.rows[0];
  }

  async findByUsername(username: string) {
    const query = `
      SELECT u.*, b.name as branch_name,
        CASE 
          WHEN u.role = 'CCO' THEN (SELECT json_agg(bd.id) FROM branch_dept bd WHERE bd.cco_user_id = u.id)
          ELSE (SELECT json_agg(bd.id) FROM branch_dept bd WHERE bd.co_user_id = u.id)
        END as managed_branch_ids
      FROM users u
      LEFT JOIN branch_dept b ON u.branch_id = b.id
      WHERE u.username = $1 AND u.is_active = true
    `;
    const result = await this.db.query(query, [username]);
    return result.rows[0];
  }

  async create(data: CreateUserDto) {
    let passwordHash = '';
    if (data.password) {
      passwordHash = await bcrypt.hash(data.password, 10);
    } else {
      // Default password if not provided
      passwordHash = await bcrypt.hash('123456', 10);
    }

    const query = `
      INSERT INTO users (
        username, password_hash, full_name, email, 
        mobile_number, role, branch_id, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, username, full_name, role, branch_id, is_active
    `;
    const values = [
      data.username,
      passwordHash,
      data.full_name,
      data.email ?? null,
      data.mobile_number ?? null,
      data.role ?? 'BRANCH_USER',
      data.branch_id ?? null,
      data.is_active ?? true,
    ];
    const result = await this.db.query(query, values);
    const user = result.rows[0];

    // Assign managed branches for CO or CCO
    if (data.role === 'CO' && data.managed_branch_ids) {
      await this.updateCoManagedBranches(user.id, data.managed_branch_ids);
    } else if (data.role === 'CCO' && data.managed_branch_ids) {
      await this.updateCcoManagedBranches(user.id, data.managed_branch_ids);
    }

    return user;
  }

  async update(id: string, data: UpdateUserDto) {
    let passwordFragment = '';
    const values: any[] = [id];
    let paramIndex = 2;

    if (data.password) {
      const hash = await bcrypt.hash(data.password, 10);
      passwordFragment = `, password_hash = $${paramIndex++}`;
      values.push(hash);
    }

    const query = `
      UPDATE users SET
        username = COALESCE($${paramIndex++}, username),
        full_name = COALESCE($${paramIndex++}, full_name),
        email = COALESCE($${paramIndex++}, email),
        mobile_number = COALESCE($${paramIndex++}, mobile_number),
        role = COALESCE($${paramIndex++}, role),
        branch_id = COALESCE($${paramIndex++}, branch_id),
        is_active = COALESCE($${paramIndex++}, is_active),
        updated_at = CURRENT_TIMESTAMP
        ${passwordFragment}
      WHERE id = $1
      RETURNING id, username, full_name, role, branch_id, is_active
    `;

    values.push(
      data.username ?? null,
      data.full_name ?? null,
      data.email ?? null,
      data.mobile_number ?? null,
      data.role ?? null,
      data.branch_id ?? null,
      data.is_active ?? null,
    );

    const result = await this.db.query(query, values);
    const user = result.rows[0];

    // Handle managed branches for CO and CCO
    const effectiveRole = data.role || user.role;
    if (data.managed_branch_ids !== undefined) {
      if (effectiveRole === 'CO') {
        await this.updateCoManagedBranches(id, data.managed_branch_ids);
        await this.updateCcoManagedBranches(id, []);
      } else if (effectiveRole === 'CCO') {
        await this.updateCcoManagedBranches(id, data.managed_branch_ids);
        await this.updateCoManagedBranches(id, []);
      } else {
        await this.updateCoManagedBranches(id, []);
        await this.updateCcoManagedBranches(id, []);
      }
    } else if (data.role && data.role !== 'CO' && data.role !== 'CCO') {
      // If role changed from CO/CCO to something else, clear branches
      await this.updateCoManagedBranches(id, []);
      await this.updateCcoManagedBranches(id, []);
    }

    return user;
  }

  private async updateCoManagedBranches(userId: string, branchIds: number[]) {
    // 1. Unassign all branches currently assigned to this CO
    await this.db.query(`UPDATE branch_dept SET co_user_id = NULL WHERE co_user_id = $1`, [userId]);

    // 2. Assign the new branches
    if (branchIds && branchIds.length > 0) {
      const placeholders = branchIds.map((_, i) => `$${i + 2}`).join(', ');
      await this.db.query(
        `UPDATE branch_dept SET co_user_id = $1 WHERE id IN (${placeholders})`,
        [userId, ...branchIds]
      );
    }
  }

  private async updateCcoManagedBranches(userId: string, branchIds: number[]) {
    // 1. Unassign all branches currently assigned to this CCO
    await this.db.query(`UPDATE branch_dept SET cco_user_id = NULL WHERE cco_user_id = $1`, [userId]);

    // 2. Assign the new branches
    if (branchIds && branchIds.length > 0) {
      const placeholders = branchIds.map((_, i) => `$${i + 2}`).join(', ');
      await this.db.query(
        `UPDATE branch_dept SET cco_user_id = $1 WHERE id IN (${placeholders})`,
        [userId, ...branchIds]
      );
    }
  }

  async remove(id: string) {
    await this.updateCoManagedBranches(id, []);
    await this.updateCcoManagedBranches(id, []);
    const query = `DELETE FROM users WHERE id = $1`;
    await this.db.query(query, [id]);
    return { deleted: true };
  }
}
