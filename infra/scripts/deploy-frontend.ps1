# Run on your computer (PowerShell) from the repository root. Needs Node.js and the AWS CLI (aws configure).
# Usage: .\infra\scripts\deploy-frontend.ps1 -Bucket <bucket> -DistributionId <id>
param(
  [Parameter(Mandatory = $true)][string]$Bucket,
  [Parameter(Mandatory = $true)][string]$DistributionId
)
$ErrorActionPreference = "Stop"
Push-Location frontend
npm ci
npm run build   # reads frontend/.env.production (not in git, see infra/frontend.env.production.example)
Pop-Location
aws s3 sync frontend/dist "s3://$Bucket" --delete
aws cloudfront create-invalidation --distribution-id $DistributionId --paths "/*"
