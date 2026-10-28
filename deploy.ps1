<#
.SYNOPSIS
  Automated deployment script for DropWindow (Serverless Ephemeral File Sharing).
  Deploys AWS SAM infrastructure, builds Next.js static frontend with deployed API URLs,
  syncs to S3 frontend bucket, and optionally invalidates CloudFront.

.PARAMETER StackName
  CloudFormation / SAM stack name (default: dropwindow-serverless)

.PARAMETER Region
  AWS Region to deploy into (default: ap-south-1)

.PARAMETER EnableCloudFront
  Enable CloudFront distribution (default: false, for immediate unverified account deploy).
#>

[CmdletBinding()]
param (
    [string]$StackName = "dropwindow-serverless",
    [string]$Region = "ap-south-1",
    [string]$EnableCloudFront = "false"
)

$ErrorActionPreference = "Stop"
$env:SAM_CLI_TELEMETRY = "0"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  DropWindow Deployment Automation (PowerShell)" -ForegroundColor Cyan
Write-Host "  Region: $Region | Stack: $StackName | CloudFront: $EnableCloudFront" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Verify Prerequisites
Write-Host "`n[1/6] Verifying CLI tools and AWS credentials..." -ForegroundColor Yellow

# Ensure SAM CLI path is available if installed in standard location
if (Test-Path "C:\Program Files\Amazon\AWSSAMCLI\bin") {
    $env:PATH = "C:\Program Files\Amazon\AWSSAMCLI\bin;$env:PATH"
}

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Error "AWS CLI is required but not installed or not in PATH."
    exit 1
}

$identity = aws sts get-caller-identity --output json 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "AWS credentials are not configured. Run 'aws configure' or export AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY."
    exit 1
}
Write-Host "AWS Identity verified successfully." -ForegroundColor Green

# Check if a previous failed stack is in ROLLBACK_COMPLETE state and delete it
$stackStatus = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].StackStatus" --output text 2>$null
if ($stackStatus -eq "ROLLBACK_COMPLETE") {
    Write-Host "Cleaning up previous ROLLBACK_COMPLETE stack..." -ForegroundColor Yellow
    aws cloudformation delete-stack --stack-name $StackName --region $Region
    aws cloudformation wait stack-delete-complete --stack-name $StackName --region $Region
    Write-Host "Cleanup complete." -ForegroundColor Green
}

# 2. Build Backend with SAM
Write-Host "`n[2/6] Building backend infrastructure with SAM and esbuild..." -ForegroundColor Yellow
sam build --template template.yaml
if ($LASTEXITCODE -ne 0) {
    Write-Error "SAM build failed."
    exit 1
}

# 3. Deploy Stack with SAM
Write-Host "`n[3/6] Deploying AWS infrastructure via SAM/CloudFormation..." -ForegroundColor Yellow
sam deploy `
    --stack-name $StackName `
    --resolve-s3 `
    --capabilities CAPABILITY_IAM `
    --region $Region `
    --parameter-overrides "EnableCloudFront=$EnableCloudFront" `
    --no-confirm-changeset `
    --no-fail-on-empty-changeset

if ($LASTEXITCODE -ne 0) {
    Write-Error "Deployment of CloudFormation stack failed."
    exit 1
}

# 4. Extract Stack Outputs
Write-Host "`n[4/6] Retrieving stack outputs..." -ForegroundColor Yellow
$outputsJson = aws cloudformation describe-stacks `
    --stack-name $StackName `
    --region $Region `
    --query "Stacks[0].Outputs" `
    --output json | ConvertFrom-Json

$outputs = @{}
foreach ($item in $outputsJson) {
    $outputs[$item.OutputKey] = $item.OutputValue
}

$CreateUploadUrl = $outputs["CreateUploadFunctionUrl"]
$GetFileUrl = $outputs["GetFileFunctionUrl"]
$DeleteFileUrl = $outputs["DeleteFileFunctionUrl"]
$FrontendBucket = $outputs["FrontendBucketName"]
$FrontendUrl = $outputs["FrontendWebsiteUrl"]
$CloudFrontId = $outputs["CloudFrontDistributionId"]

Write-Host "CreateUpload URL : $CreateUploadUrl" -ForegroundColor Cyan
Write-Host "GetFile URL      : $GetFileUrl" -ForegroundColor Cyan
Write-Host "DeleteFile URL   : $DeleteFileUrl" -ForegroundColor Cyan
Write-Host "Frontend Bucket  : $FrontendBucket" -ForegroundColor Cyan
Write-Host "Live Website URL : $FrontendUrl" -ForegroundColor Green

# 5. Build Next.js Static Export with Production API URLs
Write-Host "`n[5/6] Building Next.js static frontend (output: export)..." -ForegroundColor Yellow

$envContent = @"
NEXT_PUBLIC_CREATE_UPLOAD_URL=$CreateUploadUrl
NEXT_PUBLIC_GET_FILE_URL=$GetFileUrl
NEXT_PUBLIC_DELETE_FILE_URL=$DeleteFileUrl
"@

Set-Content -Path "frontend\.env.production" -Value $envContent -Force

$env:NEXT_PUBLIC_CREATE_UPLOAD_URL = $CreateUploadUrl
$env:NEXT_PUBLIC_GET_FILE_URL = $GetFileUrl
$env:NEXT_PUBLIC_DELETE_FILE_URL = $DeleteFileUrl

npm --prefix frontend run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Next.js build failed."
    exit 1
}

# 6. Sync Static Export to S3 Frontend Bucket & Invalidate CloudFront if enabled
Write-Host "`n[6/6] Syncing frontend to S3 with cache optimization..." -ForegroundColor Yellow
aws s3 sync frontend/out "s3://$FrontendBucket" --delete --region $Region --cache-control "public, max-age=0, must-revalidate"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to sync static files to S3 bucket $FrontendBucket."
    exit 1
}

if (Test-Path "frontend/out/_next") {
    aws s3 sync frontend/out/_next "s3://$FrontendBucket/_next" --region $Region --cache-control "public, max-age=31536000, immutable"
}

if ($EnableCloudFront -eq "true" -and $CloudFrontId) {
    Write-Host "Creating CloudFront cache invalidation..." -ForegroundColor Yellow
    aws cloudfront create-invalidation `
        --distribution-id $CloudFrontId `
        --paths "/*" `
        --region $Region
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "  Live Website URL: $FrontendUrl" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
