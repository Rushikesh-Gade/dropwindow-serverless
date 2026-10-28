import PDFDocument from './backend/node_modules/pdfkit/js/pdfkit.js';
import fs from 'node:fs';
import path from 'node:path';

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 40, bottom: 40, left: 45, right: 45 },
  bufferPages: true
});

const stream = fs.createWriteStream('working.pdf');
doc.pipe(stream);

// Colors
const PRIMARY = '#0284c7'; // Sky 600
const DARK = '#0f172a';    // Slate 900
const TEXT = '#334155';    // Slate 700
const MUTED = '#64748b';   // Slate 500
const ACCENT = '#4f46e5';  // Indigo 600
const BG_BOX = '#f8fafc';  // Slate 50
const BORDER = '#cbd5e1';  // Slate 300

function addHeader(title, subtitle) {
  doc.rect(45, 40, 505, 75).fillAndStroke('#f0f9ff', '#bae6fd');
  doc.fillColor(PRIMARY).fontSize(22).font('Helvetica-Bold').text(title, 60, 52);
  doc.fillColor(MUTED).fontSize(10).font('Helvetica').text(subtitle, 60, 80);
  doc.moveDown(2);
}

function addSectionTitle(title) {
  doc.moveDown(0.8);
  doc.fillColor(DARK).fontSize(14).font('Helvetica-Bold').text(title);
  doc.strokeColor(PRIMARY).lineWidth(1.5).moveTo(doc.x, doc.y + 2).lineTo(doc.x + 505, doc.y + 2).stroke();
  doc.moveDown(0.6);
}

function addSubSectionTitle(title) {
  doc.moveDown(0.5);
  doc.fillColor(ACCENT).fontSize(11).font('Helvetica-Bold').text(title);
  doc.moveDown(0.2);
}

function addParagraph(text) {
  doc.fillColor(TEXT).fontSize(9.5).font('Helvetica').text(text, { lineGap: 3, align: 'justify' });
  doc.moveDown(0.4);
}

function addBullet(label, text) {
  doc.fillColor(DARK).fontSize(9.5).font('Helvetica-Bold').text(`• ${label}: `, { continued: true });
  doc.fillColor(TEXT).font('Helvetica').text(text, { lineGap: 2.5 });
  doc.moveDown(0.2);
}

// ================= PAGE 1 =================
addHeader('DropWindow: Architecture & Services Guide', 'Comprehensive Breakdown of Serverless Cloud Services, Architecture & Design Decisions');

addSectionTitle('1. Executive Summary & Purpose');
addParagraph('DropWindow is a high-performance, serverless temporary file-sharing web application inspired by WeTransfer. It provides private, ephemeral file transfers with automatic time-to-live (TTL) expiration, direct browser-to-cloud uploads, and zero persistent infrastructure maintenance.');
addParagraph('The core architectural constraint is 100% pure serverless operation: NO EC2 instances, NO ECS containers, NO always-on databases, and NO traditional backend servers. When the application is idle, resource utilization and operating costs are exactly $0.00.');

addSectionTitle('2. End-to-End System Architecture Diagram');

const diagram = [
  '+-----------------------------------------------------------------------------------------+',
  '|                               CLIENT / BROWSER LAYER                                    |',
  '|  - Next.js 14 Static Export (App Router, Tailwind CSS, images: unoptimized)            |',
  '|  - Direct S3 Upload via XMLHttpRequest (Real-Time Progress 0% -> 100%)                  |',
  '|  - Ephemeral Share Page (/f/?id=XXXX) with Live JavaScript Countdown Timer               |',
  '+-------------------------------------------+---------------------------------------------+',
  '                     |                      |                      |',
  '    (1. Load HTML/Assets)       (2. Presigned POST Req)     (3. Direct Upload)',
  '                     v                      v                      v',
  '+-------------------------+   +-------------------------+   +-----------------------------+',
  '| S3 STATIC WEB HOSTING   |   | LAMBDA FUNCTION URLs    |   | S3 STORAGE BUCKET           |',
  '| - Public Read Policy    |   | - createUpload (arm64)  |   | - Private (All Public Block)|',
  '| - index.html / 404.html |   | - getFile (arm64)       |   | - SSE-AES256 Encryption     |',
  '| - /_next/static bundle  |   | - deleteFile (arm64)    |   | - CORS: Browser Uploads     |',
  '+-------------------------+   +------------+------------+   | - 1-Day Lifecycle Expiry    |',
  '                                           |                +--------------+--------------+',
  '                               (Metadata)  v                               ^',
  '                              +-------------------------+                  |',
  '                              | DYNAMODB TABLE "Files"  |                  | (60s Presigned GET)',
  '                              | - On-Demand Billing     |                  |',
  '                              | - TTL on "expiresAt"    |                  v',
  '                              | - Atomic ADD downloads  |---------> (4. Direct S3 Download)',
  '                              | - SHA-256 Delete Tokens |',
  '                              +-------------------------+',
  '+-----------------------------------------------------------------------------------------+'
].join('\n');

doc.rect(45, doc.y, 505, 175).fillAndStroke(BG_BOX, BORDER);
doc.fillColor(DARK).fontSize(7.5).font('Courier').text(diagram, 55, doc.y + 8);
doc.y += 185;

addSectionTitle('3. Core AWS Services Used & Exact Purpose');

addBullet('AWS Lambda (Serverless Compute)', 'Runs business logic on-demand without managing servers. Implemented with Node.js 20 on arm64 architecture (AWS Graviton2) for 20% lower cost and higher performance. Configured with Lambda Function URLs to bypass API Gateway costs.');

addBullet('Amazon DynamoDB (Metadata & TTL Engine)', 'Fast, scalable NoSQL key-value store operating in on-demand billing mode (PAY_PER_REQUEST). Stores file IDs, filenames, sizes, content types, download counts, and SHA-256 hashed deletion tokens with zero idle cost.');

addBullet('Amazon S3 Private Storage Bucket', 'Serves as the high-throughput, encrypted object repository for uploaded files. Employs S3 Presigned POST policies so clients stream payloads directly to S3 without routing bytes through Lambda compute.');

// ================= PAGE 2 =================
doc.addPage();

addSectionTitle('3. Core AWS Services Used & Exact Purpose (Continued)');

addBullet('Amazon S3 Static Website Hosting', 'Hosts the compiled Next.js static export (HTML, CSS, JavaScript). Provides instant static page delivery without running Node.js server processes or virtual machines.');

addBullet('AWS CloudFront CDN & OAC (Optional/Upgrade)', 'High-speed global Content Delivery Network providing automatic SSL/TLS HTTPS encryption, Gzip/Brotli edge compression, and Origin Access Control (OAC) to secure the S3 origin.');

addBullet('AWS CloudFormation & AWS SAM', 'Infrastructure as Code (IaC) tool that defines all cloud resources in a single reproducible template.yaml. Allows one-command deployment, version tracking, and deterministic cloud provisioning.');

addBullet('esbuild Bundler', 'High-performance JavaScript bundler that packages Lambda handlers, treeshakes unused code, and marks @aws-sdk/* external (using the native SDK built into the Lambda Node 20 runtime) to keep bundle sizes under 2 KB.');

addSectionTitle('4. Deep-Dive: Lambda Functions & Responsibilities');

addSubSectionTitle('A. createUpload Function (HTTP POST)');
addParagraph('Invoked when the user initiates an upload. Responsibilities:');
addBullet('Filename Sanitization', 'Strips path traversal sequences (../, \\), control characters, and illegal symbols to prevent file injection attacks.');
addBullet('Extension Filtering', 'Strictly rejects dangerous executables and scripts (.exe, .bat, .cmd, .scr, .js, .vbs, .ps1).');
addBullet('Size & Expiry Validation', 'Validates file size (1 B to 50 MB) and restricts retention choices to 1 hour, 6 hours, or 24 hours.');
addBullet('Presigned POST Generation', 'Uses @aws-sdk/s3-presigned-post to generate upload credentials containing a content-length-range condition enforcing the 50 MB boundary directly at the S3 API level.');
addBullet('Secret Deletion Token', 'Generates a 192-bit cryptographic token, hashes it with SHA-256 for DynamoDB persistence, and provides the plaintext key exclusively to the uploader.');

addSubSectionTitle('B. getFile Function (HTTP GET)');
addParagraph('Invoked when a recipient opens a share link (/f/?id=XXXX). Responsibilities:');
addBullet('Lazy TTL Protection (In-Code Expiration)', 'DynamoDB background TTL deletion may lag by up to 48 hours. getFile actively compares the epoch timestamp expiresAt <= Math.floor(Date.now() / 1000) and immediately returns HTTP 410 Gone if expired.');
addBullet('Atomic Download Counter', 'Uses DynamoDB UpdateCommand with ADD downloads :inc to atomically increment download metrics without race conditions.');
addBullet('60-Second Presigned Download URL', 'Generates an ephemeral S3 presigned GET URL valid for 60 seconds, setting ResponseContentDisposition to force a direct attachment download with the original filename.');

addSubSectionTitle('C. deleteFile Function (HTTP POST / DELETE)');
addParagraph('Invoked when an uploader requests early manual deletion before expiration. Responsibilities:');
addBullet('Timing-Safe Token Authentication', 'Hashes the submitted deleteToken with SHA-256 and validates it against DynamoDB using crypto.timingSafeEqual to eliminate timing attack vectors.');
addBullet('Immediate Purging', 'Removes the object from the S3 Storage Bucket and deletes the corresponding record from the DynamoDB table.');

// ================= PAGE 3 =================
doc.addPage();

addSectionTitle('5. Security & Cost Optimization Summary');

addParagraph('DropBox-lite incorporates multiple layers of cloud security and cost controls:');

addBullet('Zero-Cost Idle Footprint', '100% serverless design incurs $0.00 when traffic is zero. All storage automatically self-cleans within 24 hours via DynamoDB TTL and S3 Lifecycle policies.');
addBullet('No Raw File Routing Through Lambda', 'By utilizing S3 Presigned POST and GET URLs, file binaries travel directly between the client browser and S3. Lambda functions execute in < 100 ms and never consume high memory or network bandwidth.');
addBullet('Least-Privilege IAM Policies', 'Each Lambda role is restricted to the exact actions required: createUpload has s3:PutObject; getFile has s3:GetObject; deleteFile has s3:DeleteObject. No blanket administrator permissions.');
addBullet('Hardened S3 Security', 'All public access is blocked on the storage bucket. Files cannot be accessed without short-lived presigned URLs generated by authenticated backend logic.');
addBullet('Client Clipboard Resilience', 'Frontend features modern navigator.clipboard with automatic document.execCommand fallback, guaranteeing 100% copy reliability across both HTTP and HTTPS contexts.');

addSectionTitle('6. Deliverables & Repository Structure');

const repoStructure = [
  'dropwindow-serverless/',
  '├── template.yaml            # AWS SAM / CloudFormation unified IaC template',
  '├── deploy.ps1               # Automated PowerShell build, deployment & sync script',
  '├── README.md                # Full documentation, architecture diagrams & deploy steps',
  '├── working.pdf              # Comprehensive architectural & service breakdown (This Document)',
  '├── backend/',
  '│   ├── createUpload/        # Lambda handler: Validation, presigned POST, DynamoDB put',
  '│   ├── getFile/             # Lambda handler: In-code TTL check, atomic counter, presigned GET',
  '│   ├── deleteFile/          # Lambda handler: SHA-256 timing-safe auth & deletion',
  '│   └── tests/               # Automated unit tests (sanitization, size, expiry, tokens)',
  '└── frontend/',
  '    ├── next.config.mjs      # Next.js static export (output: "export", unoptimized images)',
  '    ├── app/page.tsx         # Drag-drop upload UI, progress bar, share links, copy fallback',
  '    └── app/f/page.tsx       # Share page: Live countdown timer, download button, early delete'
].join('\n');

doc.rect(45, doc.y, 505, 150).fillAndStroke(BG_BOX, BORDER);
doc.fillColor(DARK).fontSize(8).font('Courier').text(repoStructure, 55, doc.y + 8);
doc.y += 160;

// Add Page Numbering
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  doc.fillColor(MUTED).fontSize(8).font('Helvetica').text(
    `DropBox-lite Architecture Specification  |  Page ${i + 1} of ${range.count}`,
    45,
    795,
    { align: 'center', width: 505 }
  );
}

doc.end();
stream.on('finish', () => console.log('WORKING_PDF_GENERATED_SUCCESSFULLY'));
