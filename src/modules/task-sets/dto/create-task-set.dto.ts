import { IsString, IsOptional, IsArray, IsNumber, IsDateString } from 'class-validator';

export class CreateTaskSetDto {
  @IsOptional()
  created_by?: number | string;

  @IsOptional()
  created_by_id?: number | string;

  @IsOptional()
  @IsString()
  created_by_role?: string;

  @IsOptional()
  @IsString()
  creator_role?: string;

  @IsOptional()
  @IsString()
  created_by_name?: string;

  @IsOptional()
  @IsString()
  creator_name?: string;

  @IsOptional()
  @IsString()
  created_by_username?: string;

  @IsOptional()
  user_id?: number | string;

  @IsOptional()
  created_by_user_id?: number | string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  type?: string;

  // ── REGULAR (Circular-Based) fields ──────────────────────────
  @IsOptional()
  @IsNumber()
  circular_id?: number;

  @IsOptional()
  @IsDateString()
  default_due_date?: Date;

  @IsOptional()
  @IsDateString()
  end_date?: Date;

  @IsOptional()
  @IsDateString()
  reporting_date?: Date;

  // ── Shared fields ─────────────────────────────────────────────
  @IsOptional()
  @IsDateString()
  start_date?: Date;

  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsNumber()
  authority_id?: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  taskIds?: number[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  branchIds?: number[];

  // ── INTERNAL type fields ──────────────────────────────────────
  /** Replaces circular dropdown for INTERNAL tasks */
  @IsOptional()
  @IsString()
  reference_no?: string;

  // DAILY
  @IsOptional()
  @IsString()
  assignment_time?: string;

  @IsOptional()
  @IsString()
  reporting_time?: string;

  @IsOptional()
  @IsString()
  due_time?: string;

  // WEEKLY
  @IsOptional()
  @IsNumber()
  assignment_day_of_week?: number;

  @IsOptional()
  @IsNumber()
  reporting_day_of_week?: number;

  @IsOptional()
  @IsNumber()
  due_day_of_week?: number;

  // FORTNIGHT / MONTHLY
  @IsOptional()
  @IsString()
  assignment_days_of_month?: string;

  @IsOptional()
  @IsString()
  reporting_days_of_month?: string;

  @IsOptional()
  @IsString()
  due_days_of_month?: string;

  // QUARTERLY / SEMI-ANNUAL / YEARLY
  @IsOptional()
  @IsString()
  assignment_schedule?: string;

  @IsOptional()
  @IsString()
  reporting_schedule?: string;

  @IsOptional()
  @IsString()
  due_schedule?: string;
}
