import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import { createReadStream } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private uploadDir: string;

  constructor(private configService: ConfigService) {
    this.uploadDir = path.join(process.cwd(), 'uploads');
  }

  async onModuleInit() {
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
      await fs.mkdir(path.join(this.uploadDir, 'circulars'), { recursive: true });
      await fs.mkdir(path.join(this.uploadDir, 'evidence'), { recursive: true });
      await fs.mkdir(path.join(this.uploadDir, 'documents'), { recursive: true });
      await fs.mkdir(path.join(this.uploadDir, 'tasks-upload'), { recursive: true });
      this.logger.log(`Ensured local upload directories exist under: ${this.uploadDir}`);
    } catch (err: any) {
      this.logger.error(`Error creating upload directory: ${err.message}`);
    }
  }

  async uploadFile(fileBuffer: Buffer, fileName: string, mimeType: string, publishedDate?: string | Date): Promise<string> {
    const ext = fileName.split('.').pop() || 'bin';
    const hash = crypto.randomBytes(8).toString('hex');
    const targetDate = publishedDate ? new Date(publishedDate) : new Date();
    const year = targetDate.getFullYear().toString();
    const month = (targetDate.getMonth() + 1).toString().padStart(2, '0');
    
    // Structure: uploads/circulars/YYYY/MM/
    const targetDir = path.join(this.uploadDir, 'circulars', year, month);
    await fs.mkdir(targetDir, { recursive: true });

    const safeFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const uniqueFileName = `${path.parse(safeFileName).name}_${hash}.${ext}`;
    const filePath = path.join(targetDir, uniqueFileName);
    
    await fs.writeFile(filePath, fileBuffer);

    // Return the relative URL path for the frontend/API
    return `/uploads/circulars/${year}/${month}/${uniqueFileName}`;
  }

  async uploadEvidenceFile(fileBuffer: Buffer, fileName: string, mimeType?: string, targetDate?: string | Date): Promise<string> {
    const ext = fileName.split('.').pop() || 'bin';
    const hash = crypto.randomBytes(8).toString('hex');
    const dateObj = targetDate ? new Date(targetDate) : new Date();
    const year = dateObj.getFullYear().toString();
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');

    // Structure: uploads/evidence/YYYY/MM/
    const targetDir = path.join(this.uploadDir, 'evidence', year, month);
    await fs.mkdir(targetDir, { recursive: true });

    const safeFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const uniqueFileName = `${path.parse(safeFileName).name}_${hash}.${ext}`;
    const filePath = path.join(targetDir, uniqueFileName);

    await fs.writeFile(filePath, fileBuffer);

    return `/uploads/evidence/${year}/${month}/${uniqueFileName}`;
  }

  async uploadDocumentFile(fileBuffer: Buffer, fileName: string, targetDate?: string | Date): Promise<string> {
    const ext = fileName.split('.').pop() || 'bin';
    const hash = crypto.randomBytes(8).toString('hex');
    const dateObj = targetDate ? new Date(targetDate) : new Date();
    const year = dateObj.getFullYear().toString();
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');

    // Structure: uploads/documents/YYYY/MM/
    const targetDir = path.join(this.uploadDir, 'documents', year, month);
    await fs.mkdir(targetDir, { recursive: true });

    const safeFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const uniqueFileName = `${path.parse(safeFileName).name}_${hash}.${ext}`;
    const filePath = path.join(targetDir, uniqueFileName);

    await fs.writeFile(filePath, fileBuffer);

    return `/uploads/documents/${year}/${month}/${uniqueFileName}`;
  }

  async uploadTaskFile(fileBuffer: Buffer, fileName: string, targetFolder = 'tasks-upload'): Promise<string> {
    const ext = fileName.split('.').pop() || 'bin';
    const hash = crypto.randomBytes(8).toString('hex');
    const targetDir = path.join(this.uploadDir, targetFolder);
    await fs.mkdir(targetDir, { recursive: true });

    const safeFileName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    const uniqueFileName = `${path.parse(safeFileName).name}_${hash}.${ext}`;
    const filePath = path.join(targetDir, uniqueFileName);

    await fs.writeFile(filePath, fileBuffer);
    return `/uploads/${targetFolder}/${uniqueFileName}`;
  }

  async deleteFile(fileUrl: string): Promise<boolean> {
    try {
      if (!fileUrl) return false;
      let relativePath = fileUrl;
      if (fileUrl.startsWith('http')) {
        const url = new URL(fileUrl);
        relativePath = url.pathname; 
      }
      const cleanPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
      const absolutePath = path.join(process.cwd(), cleanPath);
      await fs.unlink(absolutePath);
      return true;
    } catch (err: any) {
      this.logger.warn(`Could not delete file at ${fileUrl}: ${err.message}`);
      return false;
    }
  }

  async getFileStream(fileUrl: string) {
    let relativePath = fileUrl;
    if (fileUrl.startsWith('http')) {
      const url = new URL(fileUrl);
      relativePath = url.pathname; 
    }
    
    const cleanPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
    const absolutePath = path.join(process.cwd(), cleanPath);
    
    return createReadStream(absolutePath);
  }
}
