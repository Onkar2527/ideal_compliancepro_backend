import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private readonly db: DatabaseService) { }

  async create(createBranchDto: CreateBranchDto) {
    const query = `
      INSERT INTO branch_dept (name, type, parent_id)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const result = await this.db.query(query, [
      createBranchDto.name,
      createBranchDto.type,
      createBranchDto.parent_id || null,
    ]);
    return result.rows[0];
  }

  async findAll(userRole?: string, userId?: string) {
    const result = await this.db.query(`
      SELECT b.*, p.name as parent_name 
      FROM branch_dept b
      LEFT JOIN branch_dept p ON b.parent_id = p.id
      ORDER BY b.id DESC
    `);
    return result.rows;
  }

  async findOne(id: number) {
    const result = await this.db.query(`
      SELECT b.*, p.name as parent_name 
      FROM branch_dept b
      LEFT JOIN branch_dept p ON b.parent_id = p.id
      WHERE b.id = $1
    `, [id]);
    return result.rows[0];
  }

  async update(id: number, updateBranchDto: UpdateBranchDto) {
    const query = `
      UPDATE branch_dept
      SET name = COALESCE($1, name),
          type = COALESCE($2, type),
          parent_id = $3
      WHERE id = $4
      RETURNING *
    `;
    const result = await this.db.query(query, [
      updateBranchDto.name || null,
      updateBranchDto.type || null,
      updateBranchDto.parent_id !== undefined ? updateBranchDto.parent_id : null,
      id
    ]);
    return result.rows[0];
  }

  async remove(id: number) {
    await this.db.query(`DELETE FROM branch_dept WHERE id = $1`, [id]);
    return { deleted: true };
  }
}
