<#
.SYNOPSIS
  Automated deployment script for DropBox-lite (Serverless Ephemeral File Sharing).
  Deploys AWS SAM infrastructure, builds Next.js static frontend with deployed API URLs,
  syncs to private S3 frontend bucket, and invalidates CloudFront cache.

.PARAMETER StackName
  CloudFormation / SAM stack name (default: dropwindow-serverless)

.PARAMETER Region
  AWS Region to deploy into (default: ap-south-1)
#>

[CmdletBinding()]
param (
    [string]$StackName = "dropwindow-serverless",
    [string]$Region = "ap-south-1"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  DropBox-lite Deployment Automation (PowerShell)" -ForegroundColor Cyan
Write-Host "  Region: $Region | Stack: $StackName" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Verify Prerequisites
Write-Host "`n[1/6] Verifying CLI tools..." -ForegroundColor Yellow

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

$samAvailable = $null -ne (Get-Command sam -ErrorAction SilentlyContinue)
if (-not $samAvailable) {
    Write-Warning "'sam' CLI not found in PATH. Checking if CloudFormation package/deploy should be used..."
}

# 2. Build Backend with SAM (or esbuild fallback)
Write-Host "`n[2/6] Building backend infrastructure..." -ForegroundColor Yellow
if ($samAvailable) {
    sam build --template template.yaml
    if ($LASTEXITCODE -ne 0) {
        Write-Error "SAM build failed."
        exit 1
    }
} else {
    Write-Host "Using CloudFormation direct packaging mode with template.yaml..." -ForegroundColor Yellow
}

# 3. Deploy Stack with SAM
Write-Host "`n[3/6] Deploying AWS infrastructure via SAM/CloudFormation..." -ForegroundColor Yellow
if ($samAvailable) {
    sam deploy `
        --stack-name $StackName `
        --resolve-s3 `
        --capabilities CAPABILITY_IAM `
        --region $Region `
        --no-fail-on-empty-changeset
} else {
    aws cloudformation deploy `
        --template-file template.yaml `
        --stack-name $StackName `
        --capabilities CAPABILITY_IAM `
        --region $Region `
        --no-fail-on-empty-changeset
}

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
$CloudFrontId = $outputs["CloudFrontDistributionId"]
$CloudFrontDomain = $outputs["CloudFrontDomainName"]

Write-Host "CreateUpload URL : $CreateUploadUrl" -ForegroundColor Cyan
Write-Host "GetFile URL      : $GetFileUrl" -ForegroundColor Cyan
Write-Host "DeleteFile URL   : $DeleteFileUrl" -ForegroundColor Cyan
Write-Host "Frontend Bucket  : $FrontendBucket" -ForegroundColor Cyan
Write-Host "CloudFront ID    : $CloudFrontId" -ForegroundColor Cyan
Write-Host "CloudFront Domain: https://$CloudFrontDomain" -ForegroundColor Green

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

# 6. Sync Static Export to Private S3 Frontend Bucket & Invalidate CloudFront
Write-Host "`n[6/6] Syncing frontend to S3 and invalidating CloudFront..." -ForegroundColor Yellow
aws s3 sync frontend/out "s3://$FrontendBucket" --delete --region $Region
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to sync static files to S3 bucket $FrontendBucket."
    exit 1
}

Write-Host "Creating CloudFront cache invalidation..." -ForegroundColor Yellow
aws cloudfront create-invalidation `
    --distribution-id $CloudFrontId `
    --paths "/*" `
    --region $Region

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "  DEPLOYMENT COMPLETE!" -ForegroundColor Green
Write-Host "  Live CloudFront URL: https://$CloudFrontDomain" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
