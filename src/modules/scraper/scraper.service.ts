import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../core/database/database.service';
import { CircularsService } from '../circulars/circulars.service';
import * as cheerio from 'cheerio';
import axios from 'axios';
import puppeteer from 'puppeteer';

@Injectable()
export class ScraperService implements OnModuleInit {
  private readonly logger = new Logger(ScraperService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly circularsService: CircularsService,
  ) { }

  async onModuleInit() {
    const scraperFlag = String(process.env.ENABLE_SCRAPER).trim().toLowerCase();

    if (scraperFlag === 'false') {
      this.logger.log('Scraper is disabled (ENABLE_SCRAPER=false). This instance will only run as a background worker.');
      return;
    }
    this.logger.log('Starting continuous RBI scraping service (Historical + Live)...');
    this.startContinuousScraping();
  }

  async runDryRun() {
    this.logger.log('Starting DRY RUN scrape (fetching 10 oldest circulars from default page)...');
    const rbiUrl = 'https://www.rbi.org.in/Scripts/BS_CircularIndexDisplay.aspx';
    const response = await axios.get(rbiUrl);
    await this.parseAndInsertCirculars(response.data, 10);
    this.logger.log('DRY RUN completed.');
  }

  private async startContinuousScraping() {
    let isInitialRun = true;
    while (true) {
      try {
        if (isInitialRun) {
          await this.fetchHistoricalCirculars();
          isInitialRun = false;
        } else {
          const rbiUrl = 'https://www.rbi.org.in/Scripts/BS_CircularIndexDisplay.aspx';
          const response = await axios.get(rbiUrl);
          await this.parseAndInsertCirculars(response.data);
        }
      } catch (err: any) {
        this.logger.error('Error in scraping loop', err.stack);
      }
      // Wait for 6 hours before scraping the default page again
      await new Promise(resolve => setTimeout(resolve, 6 * 60 * 60 * 1000));
    }
  }

  private async fetchHistoricalCirculars() {
    this.logger.log('Starting historical scraping using Puppeteer...');
    const puppeteerModule = await import('puppeteer');
    const puppeteer = puppeteerModule.default || puppeteerModule;
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.goto('https://www.rbi.org.in/Scripts/BS_CircularIndexDisplay.aspx', { waitUntil: 'networkidle2' });

      const years = await page.evaluate(() => {
        const yearsList: string[] = [];
        const anchors = document.querySelectorAll('h2.year a');
        for (const a of Array.from(anchors)) {
          const text = (a as HTMLElement).innerText.trim();
          if (text === 'Archives') break;
          if (text.match(/^\d{4}$/)) yearsList.push(text);
        }
        return yearsList;
      });

      this.logger.log(`Found active years to scrape: ${years.join(', ')}`);
      years.sort((a, b) => parseInt(a) - parseInt(b));

      const state = await this.db.findOne('SELECT * FROM scraper_state WHERE authority_name = $1', ['RBI']);
      const lastProcessedDate = state?.last_processed_date ? new Date(state.last_processed_date) : null;
      let startYear = 0;
      if (lastProcessedDate) {
        startYear = lastProcessedDate.getFullYear();
        this.logger.log(`Found last_processed_date: ${lastProcessedDate.toISOString()}. Resuming from year ${startYear}.`);
      }

      const yearsToScrape = years.filter(y => parseInt(y) >= startYear);

      for (const year of yearsToScrape) {
        this.logger.log(`Scraping year: ${year}...`);

        await page.evaluate((y) => {
          // First click the year to open the accordion
          const yearBtn = document.getElementById(`btn${y}`);
          if (yearBtn) yearBtn.click();
        }, year);

        await new Promise(r => setTimeout(r, 1000));

        await page.evaluate((y) => {
          // Then click 'All Months'
          const btn = document.getElementById(`${y}0`);
          if (btn) btn.click();
        }, year);

        try {
          // Wait until the table updates (we can check if the first circular year is the requested year)
          await new Promise(r => setTimeout(r, 8000)); // wait longer for AJAX
        } catch (e) {
          this.logger.warn(`Wait for nav timeout for year ${year}, proceeding anyway`);
        }

        const html = await page.content();
        await this.parseAndInsertCirculars(html);

        await new Promise(r => setTimeout(r, 5000));
      }
    } finally {
      await browser.close();
    }
  }

  private async parseAndInsertCirculars(html: string, limit?: number) {
    const state = await this.db.findOne('SELECT * FROM scraper_state WHERE authority_name = $1', ['RBI']);
    const lastProcessedDate = state?.last_processed_date ? new Date(state.last_processed_date) : null;

    const $ = cheerio.load(html);
    const circulars: { date: string; title: string; reference_no?: string | null; link: string; isWithdrawn?: boolean }[] = [];

    $('table.tablebg tr').each((i, element) => {
      if (i === 0) return;
      const tds = $(element).find('td');
      if (tds.length >= 2) {
        const linkElement = $(tds[0]).find('a');
        const link = linkElement.attr('href') || '';
        const rawRefNo = $(tds[0]).text().replace(/\s+/g, ' ').trim();
        const dateText = $(tds[1]).text().trim();

        // Subject is in column 3 (index 3) on RBI table; fallback to column 2 if table has 3 columns
        let subject = '';
        if (tds.length >= 4) {
          subject = $(tds[3]).text().replace(/\s+/g, ' ').trim();
        } else if (tds.length === 3) {
          subject = $(tds[2]).text().replace(/\s+/g, ' ').trim();
        }

        // Use subject as the clean human-readable title, fallback to reference number
        const title = subject && subject.length > 3 ? subject : rawRefNo;
        const referenceNo = rawRefNo && rawRefNo !== title ? rawRefNo : null;

        const rowHtml = $(element).html() || '';
        const isWithdrawn = (rowHtml.toLowerCase().includes('withdrawn') && (rowHtml.toLowerCase().includes('red') || rowHtml.toLowerCase().includes('#ff0000'))) || title.toLowerCase().includes('[withdrawn]');

        if (dateText && title && link) {
          circulars.push({
            date: dateText,
            title,
            reference_no: referenceNo,
            link: link.startsWith('http') ? link : `https://www.rbi.org.in/Scripts/${link}`,
            isWithdrawn
          });
        }
      }
    });

    let circularsToProcess = circulars.reverse();
    if (limit) {
      circularsToProcess = circularsToProcess.slice(0, limit);
    }

    let newestDate: Date | null = null;

    for (const circular of circularsToProcess) {
      let dateStr = circular.date.trim();
      let circularDate: Date = new Date('invalid');

      // Match DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY
      const dmyRegex = /^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/;
      const match = dateStr.match(dmyRegex);

      if (match) {
        const d = match[1].padStart(2, '0');
        const m = match[2].padStart(2, '0');
        const y = match[3];
        circularDate = new Date(`${y}-${m}-${d}T00:00:00Z`);
      } else {
        // Fallback for formats like "March 10 2021" or "10 March 2021"
        const tempDate = new Date(dateStr);
        if (!isNaN(tempDate.getTime())) {
          const y = tempDate.getFullYear();
          const m = (tempDate.getMonth() + 1).toString().padStart(2, '0');
          const d = tempDate.getDate().toString().padStart(2, '0');
          circularDate = new Date(`${y}-${m}-${d}T00:00:00Z`);
        }
      }

      if (isNaN(circularDate.getTime())) {
        this.logger.warn(`Could not parse date for circular: ${circular.title}`);
        continue;
      }

      // if (lastProcessedDate && circularDate <= lastProcessedDate) {
      //   continue; 
      // }

      const exists = await this.db.findOne('SELECT id FROM circular WHERE title = $1', [circular.title]);
      if (exists) {
        continue;
      }

      this.logger.log(`Found new circular: ${circular.title}`);
      const authority = await this.db.findOne('SELECT id FROM authority WHERE name = $1 OR name LIKE $2', ['Reserve Bank of India (RBI)', '%RBI%']);
      if (!authority) {
        this.logger.error('RBI Authority not found in DB!');
        continue;
      }

      let pdfBuffer = null;
      let pdfName = 'circular.pdf';

      try {
        const detailPage = await axios.get(circular.link);
        const $detail = cheerio.load(detailPage.data);
        const pdfLink = $detail('a').filter((i, el) => $(el).attr('href')?.toLowerCase().endsWith('.pdf')).attr('href');

        if (pdfLink) {
          const actualPdfLink = pdfLink.startsWith('http') ? pdfLink : `https://www.rbi.org.in/Scripts/${pdfLink}`;
          const pdfResponse = await axios.get(actualPdfLink, { responseType: 'arraybuffer' });
          pdfBuffer = Buffer.from(pdfResponse.data);
          const urlParts = actualPdfLink.split('/');
          pdfName = urlParts[urlParts.length - 1];
        }
      } catch (e: any) {
        this.logger.warn(`Failed to fetch PDF for ${circular.title}: ${e.message}`);
      }

      try {
        if (pdfBuffer) {
          await this.circularsService.createWithFiles({
            authority_id: authority.id,
            reference_no: circular.reference_no,
            title: circular.title,
            published_date: circularDate.toISOString().split('T')[0],
            description: 'Automated scrape from RBI website',
            portal_website: circular.link,
            is_withdrawn: circular.isWithdrawn,
          }, [
            {
              buffer: pdfBuffer,
              filename: pdfName,
              mimetype: 'application/pdf'
            }
          ]).catch(e => this.logger.error(`Failed to insert circular ${circular.title} with PDF: ${e.message}`));
        } else {
          await this.circularsService.create({
            authority_id: authority.id,
            reference_no: circular.reference_no,
            title: circular.title,
            published_date: circularDate.toISOString().split('T')[0],
            description: 'Automated scrape from RBI website (No PDF found)',
            portal_website: circular.link,
            is_withdrawn: circular.isWithdrawn,
          }).catch(e => this.logger.error(`Failed to insert circular ${circular.title}: ${e.message}`));
        }
        this.logger.log(`Successfully processed circular: ${circular.title}`);
      } catch (e: any) {
        this.logger.error(`Failed to insert circular ${circular.title} into DB`, e.stack);
        continue;
      }

      if (!newestDate || circularDate > newestDate) {
        newestDate = circularDate;
      }
    }

    if (newestDate && (!lastProcessedDate || newestDate > lastProcessedDate)) {
      await this.db.query(`
         INSERT INTO scraper_state (authority_name, last_processed_date) 
         VALUES ('RBI', $1) 
         ON CONFLICT (authority_name) 
         DO UPDATE SET last_processed_date = $1, updated_at = CURRENT_TIMESTAMP
       `, [newestDate.toISOString().split('T')[0]]);
    }
  }
}
