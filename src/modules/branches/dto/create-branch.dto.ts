import { IsOptional, IsString } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  name: string;

  @IsString()
  type: string;

  @IsOptional()
  parent_id?: number | null;
}
