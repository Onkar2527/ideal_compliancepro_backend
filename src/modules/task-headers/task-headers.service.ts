import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';

@Injectable()
export class TaskHeadersService {
  constructor(private readonly db: DatabaseService) {}

  async findAll() {
    const query = `
      SELECT * FROM task_header 
      ORDER BY COALESCE(parent_id, id) ASC, (parent_id IS NOT NULL) ASC, id ASC
    `;
    const result = await this.db.query(query);
    return result.rows;
  }

  async findOne(id: number) {
    const query = `SELECT * FROM task_header WHERE id = $1`;
    const result = await this.db.query(query, [id]);
    if (result.rowCount === 0) {
      throw new NotFoundException(`Task Header with ID ${id} not found`);
    }
    return result.rows[0];
  }

  async create(name: string) {
    const query = `
      INSERT INTO task_header (name)
      VALUES ($1)
      RETURNING *
    `;
    const result = await this.db.query(query, [name]);
    return result.rows[0];
  }

  async update(id: number, name: string) {
    const query = `
      UPDATE task_header
      SET name = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    const result = await this.db.query(query, [name, id]);
    if (result.rowCount === 0) {
      throw new NotFoundException(`Task Header with ID ${id} not found`);
    }
    return result.rows[0];
  }

  async remove(id: number) {
    const query = `DELETE FROM task_header WHERE id = $1 RETURNING id`;
    const result = await this.db.query(query, [id]);
    if (result.rowCount === 0) {
      throw new NotFoundException(`Task Header with ID ${id} not found`);
    }
    return { success: true };
  }
}
